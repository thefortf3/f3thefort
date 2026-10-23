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
 * Validates and normalises a list of occurrences (arrays with date, start_time, end_time):
 * trims, caps times at 40 characters, drops exact duplicates (same date and start time) and
 * sorts by date then start time. Throws InvalidArgumentException on a bad date.
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
		$start = substr( trim( (string) ( $o['start_time'] ?? '' ) ), 0, 40 );
		$end   = substr( trim( (string) ( $o['end_time'] ?? '' ) ), 0, 40 );
		$start = '' === $start ? null : $start;
		$end   = '' === $end ? null : $end;
		$key   = $date . '|' . $start;
		if ( isset( $seen[ $key ] ) ) {
			continue;
		}
		$seen[ $key ] = true;
		$out[]        = array( 'date' => $date, 'start_time' => $start, 'end_time' => $end );
	}
	usort(
		$out,
		function ( $a, $b ) {
			return strcmp( $a['date'], $b['date'] ) ?: strcmp( (string) $a['start_time'], (string) $b['start_time'] );
		}
	);
	return $out;
}

/** The first occurrence on/after $today, or null if every date has passed (or there are none). */
function fortw_next_occurrence( $occurrences, $today ) {
	foreach ( $occurrences as $o ) {
		if ( $o['date'] >= $today ) {
			return $o;
		}
	}
	return null;
}

/** The occurrences on/after $today. */
function fortw_upcoming_dates( $occurrences, $today ) {
	return array_values( array_filter( $occurrences, function ( $o ) use ( $today ) { return $o['date'] >= $today; } ) );
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
 * The value stored in _fort_next_date for sorting and querying: the next date, or '9999-12-31'
 * for an undated (ongoing) entry, or '0000-00-00' once every date has passed.
 */
function fortw_next_date_key( $occurrences, $today ) {
	if ( ! $occurrences ) {
		return '9999-12-31';
	}
	$next = fortw_next_occurrence( $occurrences, $today );
	return $next ? $next['date'] : '0000-00-00';
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
	$al = $a['occurrences'] ? end( $a['occurrences'] )['date'] : null;
	$bl = $b['occurrences'] ? end( $b['occurrences'] )['date'] : null;
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
