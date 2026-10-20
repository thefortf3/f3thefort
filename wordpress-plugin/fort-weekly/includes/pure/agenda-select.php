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
 * - Excluded: not approved, archived, held from the newsletter, or every date already passed.
 * - featured: the (single) featured entry, shown in the Featured card and not repeated below.
 * - this_week: next date within the next 7 days, grouped by that date.
 * - coming_up: every later next date, in date order.
 * - ongoing: entries with no dates at all.
 * Each entry appears once, at its next date; 'also' lists its later dates.
 * 'is_new': approved within the last week (since the previous weekly issue).
 */
function fortw_select_agenda( $entries, $today ) {
	$week_end  = fortw_add_days( $today, FORTW_THIS_WEEK_DAYS - 1 );
	$new_since = fortw_add_days( $today, -6 );

	$eligible = array_values(
		array_filter(
			$entries,
			function ( $e ) {
				return 'approved' === $e['status'] && empty( $e['archived'] ) && empty( $e['hold_from_newsletter'] )
					&& ( $e['next_occurrence'] || ! $e['occurrences'] );
			}
		)
	);
	$decorate = function ( $e ) use ( $new_since ) {
		$next      = $e['next_occurrence'];
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
	$rest = array();
	foreach ( $eligible as $e ) {
		if ( ! $featured || $e['id'] !== $featured['id'] ) {
			$rest[] = $decorate( $e );
		}
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
	foreach ( $dated as $e ) {
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

	$ongoing = array_values( array_filter( $rest, function ( $e ) { return ! $e['next_occurrence']; } ) );
	usort( $ongoing, function ( $a, $b ) { return strcmp( $a['title'], $b['title'] ); } );

	return array(
		'featured'  => $featured ? $decorate( $featured ) : null,
		'this_week' => $this_week,
		'coming_up' => $coming_up,
		'ongoing'   => $ongoing,
		'range'     => array( 'from' => $today, 'to' => $week_end ),
	);
}
