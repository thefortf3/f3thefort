<?php
/**
 * The "Find a workout" map: GloomSchedule's AO list grouped into the places they meet (several AOs
 * often share a park or a parking lot), with each AO's days, start time, kind and site Qs. At read
 * time each AO also gets its next scheduled workout (from the Q schedule) and its stats page.
 *
 * @package FortStats
 */

defined( 'ABSPATH' ) || exit;

const FSTATS_WEEKDAYS = array( 'monday' => 1, 'tuesday' => 2, 'wednesday' => 3, 'thursday' => 4, 'friday' => 5, 'saturday' => 6, 'sunday' => 7 );

/** "1st", "2nd" or "3rd" from a GloomSchedule event type ("1stF Workout", "2ndF", "3rdF"). */
function fstats_map_kind( $type ) {
	return preg_match( '/^\s*(1st|2nd|3rd)/i', (string) $type, $m ) ? strtolower( $m[1] ) : '1st';
}

/** A latitude/longitude pair, or null when either is missing or nonsense. */
function fstats_map_point( $lat, $lng ) {
	$lat = is_string( $lat ) ? trim( $lat ) : $lat;
	$lng = is_string( $lng ) ? trim( $lng ) : $lng;
	if ( ! is_numeric( $lat ) || ! is_numeric( $lng ) ) {
		return null;
	}
	$lat = (float) $lat;
	$lng = (float) $lng;
	if ( abs( $lat ) > 90 || abs( $lng ) > 180 || ( 0.0 === $lat && 0.0 === $lng ) ) {
		return null;
	}
	return array( round( $lat, 6 ), round( $lng, 6 ) );
}

/** Comparison key for venue names ("Catawba Ridge HS" = "Catawba Ridge High School"). */
function fstats_map_venue_key( $venue ) {
	$k = mb_strtolower( fstats_py_strip( (string) $venue ) );
	$k = preg_replace( '/\bhs\b/', 'high school', $k );
	$k = preg_replace( '/\belem\b\.?/', 'elementary', $k );
	return preg_replace( '/[^a-z0-9]+/', '', $k );
}

/**
 * GloomSchedule AO records (get_ao_details( false )['aos']) → the map. AOs shut down by $today are
 * left out; one launching later is kept with its 'starts' date. An AO with no position borrows one
 * from another AO at the same venue (current or past), else it's listed under 'unplaced'.
 */
function fstats_map_payload( array $aos, $today, $now = null ) {
	$by_venue = array();
	foreach ( $aos as $a ) {
		$pt  = fstats_map_point( $a['latitude'] ?? null, $a['longitude'] ?? null );
		$key = fstats_map_venue_key( $a['location'] ?? '' );
		if ( $pt && '' !== $key && ! isset( $by_venue[ $key ] ) ) {
			$by_venue[ $key ] = $pt;
		}
	}

	$sites    = array();
	$unplaced = array();
	foreach ( $aos as $a ) {
		$name = fstats_py_strip( (string) ( $a['name'] ?? '' ) );
		$shut = substr( (string) ( $a['shutdown_date'] ?? '' ), 0, 10 );
		if ( '' === $name || ( '' !== $shut && $shut <= $today ) ) {
			continue;
		}
		$days = array();
		foreach ( (array) ( $a['days_of_week'] ?? array() ) as $d ) {
			$n = FSTATS_WEEKDAYS[ strtolower( trim( (string) $d ) ) ] ?? 0;
			if ( $n ) {
				$days[ $n ] = $n;
			}
		}
		sort( $days );
		$launch = substr( (string) ( $a['launch_date'] ?? '' ), 0, 10 );
		$venue  = fstats_py_strip( (string) ( $a['location'] ?? '' ) );
		$item   = array(
			'name'    => $name,
			'kind'    => fstats_map_kind( $a['event_type'] ?? '' ),
			'days'    => $days,
			'time'    => fstats_hhmm( $a['start_time'] ?? null ),
			'types'   => array_values( array_filter( array_map( fn( $t ) => fstats_py_strip( (string) ( $t['type'] ?? '' ) ), (array) ( $a['workout_types'] ?? array() ) ) ) ),
			'site_qs' => array_values( array_filter( array_map( fn( $q ) => $q['f3_name'] ?? null, (array) ( $a['site_qs'] ?? array() ) ) ) ),
			'starts'  => '' !== $launch && $launch > $today ? $launch : null,
			'venue'   => '' !== $venue ? $venue : null,
		);
		$pt = fstats_map_point( $a['latitude'] ?? null, $a['longitude'] ?? null ) ?? ( $by_venue[ fstats_map_venue_key( $venue ) ] ?? null );
		if ( ! $pt ) {
			$unplaced[] = $item;
			continue;
		}
		// The same spot: within 25 m, or the same venue within 300 m (pins dropped at either end
		// of a school's parking lot).
		$vkey = fstats_map_venue_key( $venue );
		$spot = null;
		foreach ( $sites as $i => $s ) {
			$m = fstats_map_metres( $pt, array( $s['lat'], $s['lng'] ) );
			if ( $m <= 25 || ( '' !== $vkey && $m <= 300 && in_array( $vkey, $s['vkeys'], true ) ) ) {
				$spot = $i;
				break;
			}
		}
		if ( null === $spot ) {
			$sites[] = array( 'lat' => $pt[0], 'lng' => $pt[1], 'venue' => null, 'aos' => array(), 'vkeys' => array() );
			$spot    = count( $sites ) - 1;
		}
		$sites[ $spot ]['aos'][]   = $item;
		$sites[ $spot ]['vkeys'][] = $vkey;
	}

	$out = array();
	foreach ( $sites as $s ) {
		usort( $s['aos'], fn( $a, $b ) => ( ( $a['days'][0] ?? 8 ) <=> ( $b['days'][0] ?? 8 ) ) ?: strcmp( $a['time'], $b['time'] ) ?: strcmp( $a['name'], $b['name'] ) );
		$s['venue'] = fstats_map_site_venue( $s['aos'] );
		unset( $s['vkeys'] );
		$out[] = $s;
	}
	// By name, with places well outside the region (over 15 km from the middle) last.
	$center = fstats_map_center( $out );
	$far    = fn( $s ) => $center && fstats_map_metres( $center, array( $s['lat'], $s['lng'] ) ) > 15000;
	usort( $out, fn( $a, $b ) => ( $far( $a ) <=> $far( $b ) ) ?: strcasecmp( $a['venue'] ?? $a['aos'][0]['name'], $b['venue'] ?? $b['aos'][0]['name'] ) );
	foreach ( $out as $i => &$s ) {
		$s['id'] = 's' . ( $i + 1 );
	}
	unset( $s );
	usort( $unplaced, fn( $a, $b ) => strcasecmp( $a['name'], $b['name'] ) );

	return array(
		'configured'   => true,
		'generated_at' => $now ?: fstats_now_iso(),
		'center'       => $center,
		'sites'        => $out,
		'unplaced'     => $unplaced,
	);
}

/** Metres between two array( lat, lng ) points (haversine). */
function fstats_map_metres( array $a, array $b ) {
	$r  = M_PI / 180;
	$dl = ( $b[0] - $a[0] ) * $r;
	$dg = ( $b[1] - $a[1] ) * $r;
	$h  = sin( $dl / 2 ) ** 2 + cos( $a[0] * $r ) * cos( $b[0] * $r ) * sin( $dg / 2 ) ** 2;
	return 6371000 * 2 * asin( min( 1, sqrt( $h ) ) );
}

/** A site's name: the venue its AOs give most often (then the longest, then the first). */
function fstats_map_site_venue( array $aos ) {
	$count = array();
	foreach ( $aos as $a ) {
		if ( null !== $a['venue'] ) {
			$count[ $a['venue'] ] = ( $count[ $a['venue'] ] ?? 0 ) + 1;
		}
	}
	$best = null;
	foreach ( $count as $venue => $n ) {
		$venue = (string) $venue;
		if ( null === $best || $n > $count[ $best ] || ( $n === $count[ $best ] && mb_strlen( $venue ) > mb_strlen( $best ) ) ) {
			$best = $venue;
		}
	}
	return $best;
}

/** The middle of the sites (median, so one far-off AO doesn't pull it), or null with none. */
function fstats_map_center( array $sites ) {
	if ( ! $sites ) {
		return null;
	}
	$mid = function ( array $v ) {
		sort( $v );
		$n = count( $v );
		return $n % 2 ? $v[ intdiv( $n, 2 ) ] : round( ( $v[ $n / 2 - 1 ] + $v[ $n / 2 ] ) / 2, 6 );
	};
	return array( $mid( array_column( $sites, 'lat' ) ), $mid( array_column( $sites, 'lng' ) ) );
}

/**
 * The map with, for each AO: 'next' (its next scheduled workout from $today: date, time, Qs; null
 * when none is on the Q sheet), 'stats_id' (its /stats/aos/ page) and 'avg_pax' (this year).
 * $schedule is the kept Q schedule; $ao_data the core payload's ao_data (either may be null).
 */
function fstats_map_enrich( array $map, ?array $schedule, ?array $ao_data, $today ) {
	$next = array();
	foreach ( $schedule['days'] ?? array() as $day ) {
		if ( $day['date'] < $today ) {
			continue;
		}
		foreach ( $day['workouts'] as $w ) {
			if ( ! isset( $next[ $w['ao'] ] ) ) {
				$next[ $w['ao'] ] = array( 'date' => $day['date'], 'time' => $w['start_time'], 'qs' => $w['qs'] );
			}
		}
	}
	$ids = array();
	$avg = array();
	foreach ( $ao_data['all_time'] ?? array() as $r ) {
		$ids[ fstats_fng_ao_key( $r['ao_name'] ) ] = (int) $r['ao_id'];
	}
	foreach ( $ao_data['ytd'] ?? array() as $r ) {
		$avg[ fstats_fng_ao_key( $r['ao_name'] ) ] = $r['avg_pax'];
	}
	// "Dawn Patrol (Tue)" is "Dawn Patrol" in the stats.
	$key = function ( $name ) use ( $ids ) {
		$k = fstats_fng_ao_key( $name );
		return isset( $ids[ $k ] ) ? $k : fstats_fng_ao_key( preg_replace( '/\s*\([^)]*\)\s*$/', '', $name ) );
	};
	$add = function ( array $a ) use ( $next, $ids, $avg, $key ) {
		$k             = $key( $a['name'] );
		$a['next']     = $next[ $a['name'] ] ?? null;
		$a['stats_id'] = $ids[ $k ] ?? null;
		$a['avg_pax']  = $avg[ $k ] ?? null;
		return $a;
	};
	foreach ( $map['sites'] as &$s ) {
		$s['aos'] = array_map( $add, $s['aos'] );
	}
	unset( $s );
	$map['unplaced'] = array_map( $add, $map['unplaced'] );
	return $map;
}
