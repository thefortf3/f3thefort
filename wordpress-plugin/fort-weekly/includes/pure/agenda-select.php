<?php
/**
 * Which events go where, for both the homepage and the newsletter. Port of selectAgenda() in the
 * newsletter app's lib/newsletter-agenda.js; same rules.
 *
 * @package FortWeekly
 */

defined( 'ABSPATH' ) || defined( 'FORTW_TESTING' ) || exit;

const FORTW_THIS_WEEK_DAYS = 7;

/**
 * The week a newsletter built on $today covers: Monday to Sunday after the Sunday it goes out
 * (the coming Sunday, or $today if that is a Sunday).
 */
function fortw_issue_week( $today ) {
	$sunday = fortw_next_sunday( $today );
	return array( 'from' => fortw_add_days( $sunday, 1 ), 'to' => fortw_add_days( $sunday, 7 ) );
}

/** The newsletter's selection: fortw_select_agenda() over the issue's Monday–Sunday week. */
function fortw_select_issue( $entries, $today ) {
	return fortw_select_agenda( $entries, $today, fortw_issue_week( $today ) );
}

/**
 * - Excluded: not approved, archived, held from the newsletter, or every date already passed.
 * - featured: the (single) featured entry, shown in the Featured card and again in the lists
 *   below with 'featured' => true (the renderers show it there as a short line).
 * - this_week: next date within $week (default: the next 7 days from $today), grouped by date.
 * - happening_now: things running over several days that started before $week (a month's theme,
 *   a week-long drive), ending soonest first. Until then they sit at their start date like any
 *   event.
 * - coming_up: every later next date, in date order.
 * - ongoing: entries with no dates at all.
 * Each entry appears once, at its next date; 'also' lists its later dates; 'running' marks one in
 * happening_now.
 * 'is_new': approved within the last week (since the previous weekly issue).
 * $week: array( 'from' => ..., 'to' => ... ). A week starting after $today leaves out dates
 * before it (they'll have passed by the time the issue arrives).
 */
function fortw_select_agenda( $entries, $today, $week = null ) {
	$week_from = $week['from'] ?? $today;
	$week_end  = $week['to'] ?? fortw_add_days( $today, FORTW_THIS_WEEK_DAYS - 1 );
	$new_since = fortw_add_days( $today, -6 );
	if ( $week_from > $today ) {
		$entries = array_map(
			function ( $e ) use ( $week_from ) {
				$e['next_occurrence'] = fortw_next_occurrence( $e['occurrences'], $week_from );
				return $e;
			},
			$entries
		);
	}

	$eligible = array_values(
		array_filter(
			$entries,
			function ( $e ) {
				return 'approved' === $e['status'] && empty( $e['archived'] ) && empty( $e['hold_from_newsletter'] )
					&& ( $e['next_occurrence'] || ! $e['occurrences'] );
			}
		)
	);
	$decorate = function ( $e ) use ( $new_since, $week_from ) {
		$next      = $e['next_occurrence'];
		$e['running'] = $next && fortw_is_running( $next, $week_from ); // In Happening now.
		$e['also'] = $next ? array_values( array_map( function ( $o ) { return $o['date']; }, array_filter( $e['occurrences'], function ( $o ) use ( $next ) { return $o['date'] > $next['date']; } ) ) ) : array();
		$e['is_new'] = ! empty( $e['approved_at'] ) && substr( $e['approved_at'], 0, 10 ) >= $new_since;
		return $e;
	};

	$featured = null;
	foreach ( $eligible as $e ) {
		if ( ! empty( $e['featured'] ) ) {
			$featured = $e;
			break;
		}
	}
	// Everything, the featured entry included, also goes in the date list; 'featured' marks the one
	// in the Featured card (shown there in full, in the list as a short line that links to it).
	$rest = array();
	foreach ( $eligible as $e ) {
		$e['featured'] = $featured && $e['id'] === $featured['id'];
		$rest[]        = $decorate( $e );
	}

	$dated = array_values( array_filter( $rest, function ( $e ) { return (bool) $e['next_occurrence']; } ) );
	usort(
		$dated,
		function ( $a, $b ) {
			return strcmp( $a['next_occurrence']['date'], $b['next_occurrence']['date'] )
				?: strcmp( (string) $a['next_occurrence']['start_time'], (string) $b['next_occurrence']['start_time'] )
				?: strcmp( $a['title'], $b['title'] );
		}
	);

	$this_week = array();
	$coming_up = array();
	$now       = array();
	foreach ( $dated as $e ) {
		if ( $e['running'] ) {
			$now[] = $e;
			continue;
		}
		$date = $e['next_occurrence']['date'];
		if ( $date > $week_end ) {
			$coming_up[] = $e;
			continue;
		}
		$last = count( $this_week ) - 1;
		if ( $last < 0 || $this_week[ $last ]['date'] !== $date ) {
			$this_week[] = array( 'date' => $date, 'entries' => array() );
			$last++;
		}
		$this_week[ $last ]['entries'][] = $e;
	}

	usort( $now, function ( $a, $b ) { return strcmp( $a['next_occurrence']['end_date'], $b['next_occurrence']['end_date'] ) ?: strcmp( $a['title'], $b['title'] ); } );

	$ongoing = array_values( array_filter( $rest, function ( $e ) { return ! $e['next_occurrence']; } ) );
	usort( $ongoing, function ( $a, $b ) { return strcmp( $a['title'], $b['title'] ); } );

	return array(
		'featured'  => $featured ? $decorate( $featured ) : null,
		'this_week'     => $this_week,
		'happening_now' => $now,
		'coming_up'     => $coming_up,
		'ongoing'   => $ongoing,
		'range'     => array( 'from' => $week_from, 'to' => $week_end ),
	);
}
