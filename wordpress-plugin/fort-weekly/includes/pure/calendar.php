<?php
/**
 * "Add to calendar": an event's dates as an iCalendar file (.ics: iPhone, Mac, Outlook) and as a
 * Google Calendar link (Android). Times are the stored 24-hour "HHMM" ones (read again with
 * fortw_parse_time() for any saved before they were converted), in the region's timezone
 * (FORT_WEEKLY_TZ). No time, or one that can't be read: an all-day event. A start with no end:
 * an hour long. An end before the start: the next morning.
 *
 * @package FortWeekly
 */

defined( 'ABSPATH' ) || defined( 'FORTW_TESTING' ) || exit;

/**
 * An occurrence's span: array( 'all_day' => bool, 'start' => DateTimeImmutable, 'end' => …), in
 * FORT_WEEKLY_TZ. An all-day span ends at midnight after its date (as both formats want).
 */
function fortw_cal_span( $occ ) {
	$tz    = new DateTimeZone( FORT_WEEKLY_TZ );
	$day   = new DateTimeImmutable( $occ['date'] . ' 00:00:00', $tz );
	$start = fortw_parse_time( (string) ( $occ['start_time'] ?? '' ) );
	if ( null === $start ) {
		return array( 'all_day' => true, 'start' => $day, 'end' => $day->modify( '+1 day' ) );
	}
	$at  = function ( $hhmm ) use ( $day ) { return $day->setTime( (int) substr( $hhmm, 0, 2 ), (int) substr( $hhmm, 2, 2 ) ); };
	$from = $at( $start );
	$end  = fortw_parse_time( (string) ( $occ['end_time'] ?? '' ) );
	$to   = null === $end ? $from->modify( '+1 hour' ) : $at( $end );
	if ( $to == $from ) { // phpcs:ignore Universal.Operators.StrictComparisons -- DateTime values
		$to = $from->modify( '+1 hour' );
	} elseif ( $to < $from ) {
		$to = $to->modify( '+1 day' );
	}
	return array( 'all_day' => false, 'start' => $from, 'end' => $to );
}

/** Text for an iCalendar value: backslash, comma, semicolon and newlines escaped. */
function fortw_ics_text( $s ) {
	return str_replace( array( '\\', ';', ',', "\r\n", "\n", "\r" ), array( '\\\\', '\\;', '\\,', '\\n', '\\n', '\\n' ), (string) $s );
}

/** An iCalendar line folded at 75 octets (continuation lines start with a space), with CRLF. */
function fortw_ics_line( $line ) {
	$out = '';
	while ( strlen( $line ) > 75 ) {
		$cut = 75;
		while ( $cut > 0 && ( ord( $line[ $cut ] ) & 0xC0 ) === 0x80 ) {
			$cut--; // Never inside a UTF-8 character.
		}
		$out .= substr( $line, 0, $cut ) . "\r\n";
		$line = ' ' . substr( $line, $cut );
	}
	return $out . $line . "\r\n";
}

/**
 * An .ics file with one event per occurrence. $e: id, title, location, summary, url, and
 * occurrences (date, start_time, end_time). $stamp: a Unix time for DTSTAMP. Times are written in
 * UTC, so no timezone block is needed.
 */
function fortw_ics( $e, $occurrences, $stamp, $host = 'f3thefort.com' ) {
	$utc  = new DateTimeZone( 'UTC' );
	$text = trim( implode( "\n\n", array_filter( array( (string) ( $e['summary'] ?? '' ), (string) ( $e['url'] ?? '' ) ), 'strlen' ) ) );
	$out  = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//The Fort F3//Fort Weekly//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\n";
	foreach ( $occurrences as $occ ) {
		$span = fortw_cal_span( $occ );
		$out .= "BEGIN:VEVENT\r\n";
		$out .= fortw_ics_line( 'UID:fortw-' . (int) $e['id'] . '-' . str_replace( '-', '', $occ['date'] ) . '@' . $host );
		$out .= 'DTSTAMP:' . gmdate( 'Ymd\THis\Z', (int) $stamp ) . "\r\n";
		if ( $span['all_day'] ) {
			$out .= 'DTSTART;VALUE=DATE:' . $span['start']->format( 'Ymd' ) . "\r\nDTEND;VALUE=DATE:" . $span['end']->format( 'Ymd' ) . "\r\n";
		} else {
			$out .= 'DTSTART:' . $span['start']->setTimezone( $utc )->format( 'Ymd\THis\Z' ) . "\r\nDTEND:" . $span['end']->setTimezone( $utc )->format( 'Ymd\THis\Z' ) . "\r\n";
		}
		$out .= fortw_ics_line( 'SUMMARY:' . fortw_ics_text( $e['title'] ) );
		if ( ! empty( $e['location'] ) ) {
			$out .= fortw_ics_line( 'LOCATION:' . fortw_ics_text( $e['location'] ) );
		}
		if ( '' !== $text ) {
			$out .= fortw_ics_line( 'DESCRIPTION:' . fortw_ics_text( $text ) );
		}
		if ( ! empty( $e['url'] ) ) {
			$out .= fortw_ics_line( 'URL:' . $e['url'] );
		}
		$out .= "END:VEVENT\r\n";
	}
	return $out . "END:VCALENDAR\r\n";
}

/** A Google Calendar "add event" link for one occurrence (the times in the region's timezone). */
function fortw_google_calendar_url( $e, $occ ) {
	$span  = fortw_cal_span( $occ );
	$fmt   = $span['all_day'] ? 'Ymd' : 'Ymd\THis';
	$text  = trim( implode( "\n\n", array_filter( array( (string) ( $e['summary'] ?? '' ), (string) ( $e['url'] ?? '' ) ), 'strlen' ) ) );
	$query = array(
		'action'  => 'TEMPLATE',
		'text'    => (string) $e['title'],
		'dates'   => $span['start']->format( $fmt ) . '/' . $span['end']->format( $fmt ),
		'details' => $text,
	);
	if ( ! $span['all_day'] ) {
		$query['ctz'] = FORT_WEEKLY_TZ;
	}
	if ( ! empty( $e['location'] ) ) {
		$query['location'] = (string) $e['location'];
	}
	return 'https://calendar.google.com/calendar/render?' . http_build_query( $query, '', '&', PHP_QUERY_RFC3986 );
}
