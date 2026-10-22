<?php
// The Find a workout map: GloomSchedule AOs → places, plus next workout and stats links.

function fstats_test_aos() {
	$ao = fn( $name, $venue, $lat, $lng, $days, $time = '05:15:00', $type = '1stF Workout', $extra = array() ) => $extra + array(
		'name'          => $name,
		'location'      => $venue,
		'latitude'      => $lat,
		'longitude'     => $lng,
		'start_time'    => $time,
		'days_of_week'  => $days,
		'event_type'    => $type,
		'workout_types' => array( array( 'type' => 'Bootcamp' ) ),
		'launch_date'   => null,
		'shutdown_date' => null,
		'site_qs'       => array( array( 'f3_name' => 'Cubbie' ) ),
	);
	return array(
		$ao( 'Block Party', 'Walter Elisha Park', 35.00956, ' -80.95017', array( 'Tuesday' ) ),
		$ao( 'The Fort', 'WEP', 35.009561, -80.950171, array( 'Saturday' ), '06:30:00' ),
		$ao( 'Dawn Patrol (Tue)', 'Walter Elisha Park', 35.00956, -80.95017, array( 'Tuesday' ), '06:15:00' ),
		$ao( 'Cockpit', 'Catawba Ridge High School', 34.979772, -80.932517, array( 'Wednesday', 'Monday' ) ),
		$ao( 'Snake Pit', 'Catawba Ridge HS', null, null, array( 'Tuesday' ) ),
		$ao( 'La Grama', 'Fort Mill Care Center', null, null, array( 'Saturday' ), '09:15:00', '2ndF' ),
		$ao( 'The Ranch', 'Springfield Elem.', null, null, array( 'Thursday' ), '05:15:00', '1stF Workout', array( 'shutdown_date' => '2025-12-18' ) ),
		$ao( 'Currahee', 'Tega Cay Elementary', 35.052878, -81.006324, array( 'Tuesday' ) ),
		$ao( 'Kitchen Sink', 'Tega Cay Elementary', 35.05277, -81.006375, array( 'Wednesday' ) ),
		$ao( 'Colosseum', 'Gold Hill Middle', 35.0525, -81.0045, array( 'Tuesday' ) ),
		$ao( 'The Testament', 'Peach Stand', '35.077155', '-80.934251', array( 'Monday' ), '06:30:00', '3rdF', array( 'launch_date' => '2026-10-27' ) ),
	);
}

fortw_test(
	'Map: AOs at one spot share a pin, named by the venue most of them give',
	function () {
		$map = fstats_map_payload( fstats_test_aos(), '2026-10-22', 'now' );
		$wep = array_values( array_filter( $map['sites'], fn( $s ) => 'Walter Elisha Park' === $s['venue'] ) );
		assert_same( 1, count( $wep ) );
		assert_same( array( 'Block Party', 'Dawn Patrol (Tue)', 'The Fort' ), array_column( $wep[0]['aos'], 'name' ), 'by day, then time' );
		assert_same( array( 2 ), $wep[0]['aos'][0]['days'] );
		assert_same( '0515', $wep[0]['aos'][0]['time'] );
		assert_same( array( 'Cubbie' ), $wep[0]['aos'][0]['site_qs'] );
		assert_same( array( 35.00956, -80.95017 ), array( $wep[0]['lat'], $wep[0]['lng'] ) );
	}
);

fortw_test(
	'Map: an AO with no position borrows its venue’s; else it’s unplaced; shut-down AOs drop off',
	function () {
		$map    = fstats_map_payload( fstats_test_aos(), '2026-10-22', 'now' );
		$cr     = array_values( array_filter( $map['sites'], fn( $s ) => 'Catawba Ridge High School' === $s['venue'] ) );
		assert_same( array( 'Cockpit', 'Snake Pit' ), array_column( $cr[0]['aos'], 'name' ) );
		assert_same( array( 1, 3 ), $cr[0]['aos'][0]['days'], 'days in week order' );
		assert_same( array( 'La Grama' ), array_column( $map['unplaced'], 'name' ) );
		assert_same( '2nd', $map['unplaced'][0]['kind'] );
		$all = array_merge( ...array_map( fn( $s ) => array_column( $s['aos'], 'name' ), $map['sites'] ) );
		assert_true( ! in_array( 'The Ranch', $all, true ), 'shut down' );
		assert_same( array( 'Catawba Ridge High School', 'Gold Hill Middle', 'Peach Stand', 'Tega Cay Elementary', 'Walter Elisha Park' ), array_column( $map['sites'], 'venue' ), 'one pin per venue; a different venue 170 m away keeps its own' );
		assert_same( array( 'Currahee', 'Kitchen Sink' ), array_column( $map['sites'][3]['aos'], 'name' ), '12 m apart, same venue' );
		assert_same( array( 's1', 's2', 's3', 's4', 's5' ), array_column( $map['sites'], 'id' ) );
		assert_true( ! isset( $map['sites'][0]['vkeys'] ) );
	}
);

fortw_test(
	'Map: a new AO keeps its start date; the centre is the median spot',
	function () {
		$map  = fstats_map_payload( fstats_test_aos(), '2026-10-22', 'now' );
		$test = $map['sites'][2]['aos'][0];
		assert_same( array( 'The Testament', '3rd', '2026-10-27' ), array( $test['name'], $test['kind'], $test['starts'] ) );
		assert_same( array( 35.0525, -80.95017 ), $map['center'] );
		assert_true( abs( fstats_map_metres( array( 35.0, -81.0 ), array( 35.01, -81.0 ) ) - 1112 ) < 2 );
		assert_same( null, fstats_map_center( array() ) );
		assert_same( null, fstats_map_point( '', 3 ) );
		assert_same( null, fstats_map_point( 0, 0 ) );
	}
);

fortw_test(
	'Map: each AO gets its next scheduled workout, stats page and average PAX',
	function () {
		$map      = fstats_map_payload( fstats_test_aos(), '2026-10-22', 'now' );
		$schedule = array(
			'days' => array(
				array( 'date' => '2026-10-21', 'workouts' => array( array( 'ao' => 'Cockpit', 'start_time' => '0515', 'qs' => array( 'Old' ) ) ) ),
				array( 'date' => '2026-10-27', 'workouts' => array( array( 'ao' => 'Block Party', 'start_time' => '0515', 'qs' => array( 'Cubbie', 'Dojo' ) ), array( 'ao' => 'Dawn Patrol (Tue)', 'start_time' => '0615', 'qs' => array( 'Minuteman' ) ) ) ),
				array( 'date' => '2026-11-03', 'workouts' => array( array( 'ao' => 'Block Party', 'start_time' => '0515', 'qs' => array( 'Later' ) ) ) ),
			),
		);
		$ao_data  = array(
			'all_time' => array( array( 'ao_id' => 51942, 'ao_name' => 'Block Party' ), array( 'ao_id' => 9, 'ao_name' => 'Dawn Patrol' ), array( 'ao_id' => 4, 'ao_name' => 'Fort' ) ),
			'ytd'      => array( array( 'ao_id' => 51942, 'ao_name' => 'Block Party', 'avg_pax' => 13.1 ) ),
		);
		$out = fstats_map_enrich( $map, $schedule, $ao_data, '2026-10-22' );
		$wep = array_column( $out['sites'][4]['aos'], null, 'name' );
		assert_same( array( 'date' => '2026-10-27', 'time' => '0515', 'qs' => array( 'Cubbie', 'Dojo' ) ), $wep['Block Party']['next'] );
		assert_same( 51942, $wep['Block Party']['stats_id'] );
		assert_same( 13.1, $wep['Block Party']['avg_pax'] );
		assert_same( 9, $wep['Dawn Patrol (Tue)']['stats_id'], 'day suffix dropped to match' );
		assert_same( 4, $wep['The Fort']['stats_id'], '"The" ignored' );
		assert_same( null, $wep['The Fort']['next'] );
		assert_same( null, $out['sites'][0]['aos'][0]['next'], 'yesterday’s workout isn’t next' );
		assert_same( null, $out['unplaced'][0]['stats_id'] );
		$bare = fstats_map_enrich( $map, null, null, '2026-10-22' );
		assert_same( null, $bare['sites'][0]['aos'][0]['avg_pax'] );
	}
);

fortw_test(
	'Map: places far outside the region are listed last',
	function () {
		$aos   = fstats_test_aos();
		$aos[] = array_merge( $aos[0], array( 'name' => 'The Cyclone (Chester)', 'location' => '1330 J A Cochran Bypass, Chester', 'latitude' => 34.689151, 'longitude' => -81.200915 ) );
		$map   = fstats_map_payload( $aos, '2026-10-22', 'now' );
		assert_same( '1330 J A Cochran Bypass, Chester', $map['sites'][ count( $map['sites'] ) - 1 ]['venue'] );
		assert_same( 'Catawba Ridge High School', $map['sites'][0]['venue'] );
	}
);
