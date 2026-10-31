<?php
/**
 * Calendar dates, occurrences and an entry's lifecycle. Pure functions, no WordPress calls, so
 * they're unit-tested on their own (tests/). Ported from the newsletter app's lib/dates.js and
 * lib/entries.js; the rules are the same.
 *
 * Dates are plain YYYY-MM-DD strings for the Fort's region; "today" is read in the region's
 * timezone (FORT_WEEKLY_TZ, default America/New_York) rather than the server's.
 *
 * @package FortWeekly
 */

defined( 'ABSPATH' ) || defined( 'FORTW_TESTING' ) || exit;

if ( ! defined( 'FORT_WEEKLY_TZ' ) ) {
	define( 'FORT_WEEKLY_TZ', 'America/New_York' );
}

/** Today's date (YYYY-MM-DD) in the region's timezone. $now: a Unix timestamp, for tests. */
function fortw_today( $now = null ) {
	$dt = new DateTime( '@' . ( null === $now ? time() : (int) $now ) );
	$dt->setTimezone( new DateTimeZone( FORT_WEEKLY_TZ ) );
	return $dt->format( 'Y-m-d' );
}

/** $iso plus $n days (negative to go back). */
function fortw_add_days( $iso, $n ) {
	$dt = new DateTime( $iso . ' 00:00:00', new DateTimeZone( 'UTC' ) );
	$dt->modify( ( $n >= 0 ? '+' : '' ) . (int) $n . ' days' );
	return $dt->format( 'Y-m-d' );
}

/** True for a real YYYY-MM-DD calendar date (rejects 2026-02-30 and friends). */
function fortw_is_iso_date( $s ) {
	if ( ! is_string( $s ) || ! preg_match( '/^(\d{4})-(\d{2})-(\d{2})$/', $s, $m ) ) {
		return false;
	}
	return checkdate( (int) $m[2], (int) $m[3], (int) $m[1] );
}

/** { dow: 'SAT', mon: 'OCT', day: 24 } for a date. */
function fortw_date_parts( $iso ) {
	$ts = strtotime( $iso . ' 00:00:00 UTC' );
	return array(
		'dow'      => strtoupper( gmdate( 'D', $ts ) ),
		'mon'      => strtoupper( gmdate( 'M', $ts ) ),
		'day'      => (int) gmdate( 'j', $ts ),
		'long_dow' => strtoupper( gmdate( 'l', $ts ) ),
	);
}

/**
 * A typed time in F3's 24-hour form, "HHMM" ("0530", "1730"), or null if it can't be read.
 * Reads 0530, 05:30, 530, 5:30am, 5 AM, 5:30 p.m., noon, midnight, and a time with words after
 * it ("0900 Hours (Race Begins)"). Without am/pm it's already 24-hour: "5:30" is 0530.
 */
function fortw_parse_time( $text ) {
	$s = strtolower( trim( (string) $text ) );
	if ( preg_match( '/^noon\b/', $s ) ) {
		return '1200';
	}
	if ( preg_match( '/^midnight\b/', $s ) ) {
		return '0000';
	}
	if ( ! preg_match( '/^(\d{1,2})(?::?(\d{2}))?\s*(?:([ap])\.?\s*m?\.?(?![a-z]))?(?![\d:])/', $s, $m ) ) {
		return null;
	}
	$h   = (int) $m[1];
	$min = isset( $m[2] ) && '' !== $m[2] ? (int) $m[2] : 0;
	$mer = $m[3] ?? '';
	if ( $min > 59 || ( '' !== $mer && ( $h < 1 || $h > 12 ) ) || ( '' === $mer && $h > 24 ) || ( 24 === $h && $min > 0 ) ) {
		return null;
	}
	if ( 'p' === $mer && $h < 12 ) {
		$h += 12;
	} elseif ( ( 'a' === $mer && 12 === $h ) || 24 === $h ) {
		$h = 0;
	}
	return sprintf( '%02d%02d', $h, $min );
}

/**
 * A typed start and end as array( start, end ) in 24-hour "HHMM" form (or null). The start can
 * hold the whole range ("1730–1930", "6-7pm", "5:30 to 6:30am"), and an am/pm given only once
 * applies to both ("6-7pm" is 1800–1900; "11-1pm" is 1100–1300) when the start is written the
 * 12-hour way ("5:30", "11"; never "0530", which is already 24-hour).
 */
function fortw_parse_time_range( $start, $end = '' ) {
	$start = trim( (string) $start );
	$end   = trim( (string) $end );
	$bits  = preg_split( '/\s*(?:–|—|-|\bto\b|\buntil\b)\s*/u', $start, 2 );
	if ( '' === $end && count( $bits ) > 1 ) {
		list( $start, $end ) = $bits;
	}
	$mer = '/([ap])\.?\s*m?\.?\s*$/i';
	$a   = fortw_parse_time( $start );
	$b   = '' === $end ? null : fortw_parse_time( $end );
	if ( null !== $a && null !== $b && preg_match( $mer, $end, $em ) && preg_match( '/^(?:(?:1[0-2]|[1-9])(?::[0-5]\d)?|[1-9][0-5]\d)$/', $start ) ) {
		$with = fortw_parse_time( preg_replace( '/\s+$/', '', $start ) . ' ' . $em[1] . 'm' );
		$a    = null !== $with && $with <= $b ? $with : fortw_parse_time( $start . ' ' . ( 'p' === strtolower( $em[1] ) ? 'a' : 'p' ) . 'm' );
	}
	return array( $a, $b );
}

/**
 * Validates and normalises a list of occurrences (arrays with date, start_time, end_time, and an
 * optional end_date for something that runs over several days, like a month's theme or a week-long
 * drive; one on or before date is dropped):
 * times become 24-hour "HHMM" (fortw_parse_time_range(); one that can't be read is kept as
 * typed, capped at 40 characters; "0000" alone or 0000–2359 means no time), exact duplicates
 * (same date and start time) are dropped, and the list is sorted by date then start time.
 * Throws InvalidArgumentException on a bad date.
 */
function fortw_normalize_occurrences( $list ) {
	if ( ! is_array( $list ) ) {
		throw new InvalidArgumentException( 'occurrences must be an array' );
	}
	$seen = array();
	$out  = array();
	foreach ( $list as $o ) {
		$o    = (array) $o;
		$date = isset( $o['date'] ) && is_string( $o['date'] ) ? trim( $o['date'] ) : '';
		if ( ! fortw_is_iso_date( $date ) ) {
			throw new InvalidArgumentException( 'Invalid occurrence date: ' . ( is_scalar( $o['date'] ?? null ) ? $o['date'] : '' ) );
		}
		$raw_s = substr( trim( (string) ( $o['start_time'] ?? '' ) ), 0, 40 );
		$raw_e = substr( trim( (string) ( $o['end_time'] ?? '' ) ), 0, 40 );
		list( $a, $b ) = fortw_parse_time_range( $raw_s, $raw_e );
		// Read times are 24-hour; one that can't be read stays as typed.
		$start = null !== $a ? $a : ( '' === $raw_s ? null : $raw_s );
		$end   = null !== $b ? $b : ( '' === $raw_e ? null : $raw_e );
		if ( null !== $end && $end === $start ) {
			$end = null; // "1800–1800": no end given, really.
		}
		if ( '0000' === $start && ( null === $end || '2359' === $end ) ) {
			$start = null; // A placeholder for "all day".
			$end   = null;
		}
		$until = isset( $o['end_date'] ) && is_string( $o['end_date'] ) ? trim( $o['end_date'] ) : '';
		if ( '' !== $until && ! fortw_is_iso_date( $until ) ) {
			throw new InvalidArgumentException( 'Invalid end date: ' . $until );
		}
		$key   = $date . '|' . $start;
		if ( isset( $seen[ $key ] ) ) {
			continue;
		}
		$seen[ $key ] = true;
		$row          = array( 'date' => $date, 'start_time' => $start, 'end_time' => $end );
		if ( $until > $date ) {
			$row['end_date'] = $until; // Only when it runs over several days.
		}
		$out[] = $row;
	}
	usort(
		$out,
		function ( $a, $b ) {
			return strcmp( $a['date'], $b['date'] ) ?: strcmp( (string) $a['start_time'], (string) $b['start_time'] );
		}
	);
	return $out;
}

/** An occurrence's last day: its end_date when it runs over several days, else its date. */
function fortw_last_day( $o ) {
	return ! empty( $o['end_date'] ) ? $o['end_date'] : $o['date'];
}

/** True while a multi-day occurrence has started before $day and not yet ended. */
function fortw_is_running( $o, $day ) {
	return ! empty( $o['end_date'] ) && $o['date'] < $day && $o['end_date'] >= $day;
}

/**
 * The first occurrence that hasn't finished by $today (one still running counts), or null if
 * every date has passed (or there are none).
 */
function fortw_next_occurrence( $occurrences, $today ) {
	foreach ( $occurrences as $o ) {
		if ( fortw_last_day( $o ) >= $today ) {
			return $o;
		}
	}
	return null;
}

/** The occurrences that haven't finished by $today. */
function fortw_upcoming_dates( $occurrences, $today ) {
	return array_values( array_filter( $occurrences, function ( $o ) use ( $today ) { return fortw_last_day( $o ) >= $today; } ) );
}

/** The last day of any of the occurrences ('' for none). */
function fortw_final_day( $occurrences ) {
	return $occurrences ? max( array_map( 'fortw_last_day', $occurrences ) ) : '';
}

/**
 * Where an entry sits: 'archived', 'pending' or 'rejected' for those states; otherwise
 * 'upcoming' (has a date today or later), 'ongoing' (no dates at all) or 'past'.
 * $entry: array with status, archived (bool) and occurrences.
 */
function fortw_lifecycle( $entry, $today ) {
	if ( ! empty( $entry['archived'] ) ) {
		return 'archived';
	}
	if ( in_array( $entry['status'], array( 'pending', 'rejected' ), true ) ) {
		return $entry['status'];
	}
	if ( ! $entry['occurrences'] ) {
		return 'ongoing';
	}
	return fortw_next_occurrence( $entry['occurrences'], $today ) ? 'upcoming' : 'past';
}

/**
 * The value stored in _fort_next_date for sorting and querying: the next date (today for one
 * already running), or '9999-12-31' for an undated (ongoing) entry, or '0000-00-00' once every
 * date has passed.
 */
function fortw_next_date_key( $occurrences, $today ) {
	if ( ! $occurrences ) {
		return '9999-12-31';
	}
	$next = fortw_next_occurrence( $occurrences, $today );
	return $next ? max( $next['date'], $today ) : '0000-00-00';
}

/**
 * Sort order for entry lists: next date first (soonest first), then undated, then past (most
 * recent first). Ties keep creation order (oldest first), as the old app's stable sort did.
 */
function fortw_compare_entries( $a, $b ) {
	return fortw_compare_entries_main( $a, $b )
		?: strcmp( (string) ( $a['created_at'] ?? '' ), (string) ( $b['created_at'] ?? '' ) )
		?: ( ( $a['id'] ?? 0 ) <=> ( $b['id'] ?? 0 ) );
}

function fortw_compare_entries_main( $a, $b ) {
	$an = $a['next_occurrence']['date'] ?? null;
	$bn = $b['next_occurrence']['date'] ?? null;
	if ( $an && $bn ) {
		return strcmp( $an, $bn )
			?: strcmp( (string) $a['next_occurrence']['start_time'], (string) $b['next_occurrence']['start_time'] )
			?: strcmp( $a['title'], $b['title'] );
	}
	if ( $an ) {
		return -1;
	}
	if ( $bn ) {
		return 1;
	}
	$al = $a['occurrences'] ? fortw_final_day( $a['occurrences'] ) : null;
	$bl = $b['occurrences'] ? fortw_final_day( $b['occurrences'] ) : null;
	if ( ! $al && ! $bl ) {
		return strcmp( $a['title'], $b['title'] );
	}
	if ( ! $al ) {
		return -1;
	}
	if ( ! $bl ) {
		return 1;
	}
	return strcmp( $bl, $al );
}

/** Converts the old app's single-date columns into one occurrence, or null when undated. */
function fortw_legacy_to_occurrence( $start_date, $start_time, $end_time ) {
	if ( ! $start_date ) {
		return null;
	}
	$bits = explode( 'T', (string) $start_date );
	if ( ! fortw_is_iso_date( $bits[0] ) ) {
		return null;
	}
	$start = $start_time ? $start_time : ( isset( $bits[1] ) ? str_replace( ':', '', substr( $bits[1], 0, 5 ) ) : null );
	$end   = $end_time ? $end_time : null;
	if ( $end && false !== strpos( $end, 'T' ) ) {
		$end = substr( explode( 'T', $end )[1], 0, 5 );
	}
	return array( 'date' => $bits[0], 'start_time' => $start ? $start : null, 'end_time' => $end );
}
