<?php
// Shaping the payloads for the stats pages.

function fstats_test_core() {
	return array(
		'leaderboards'     => array(
			'ytd'      => array(
				array( 'user_id' => 1, 'f3_name' => 'Dojo', 'total_posts' => 10, 'qs' => 1, 'coqs' => 0 ),
				array( 'user_id' => 2, 'f3_name' => 'Fishstix', 'total_posts' => 8, 'qs' => 4, 'coqs' => 1 ),
				array( 'user_id' => 3, 'f3_name' => 'Time Machine', 'total_posts' => 8, 'qs' => 0, 'coqs' => 0 ),
			),
			'all_time' => array(
				array( 'user_id' => 2, 'f3_name' => 'Fishstix', 'total_posts' => 900, 'qs' => 200, 'coqs' => 1 ),
				array( 'user_id' => 1, 'f3_name' => 'Dojo', 'total_posts' => 557, 'qs' => 43, 'coqs' => 1 ),
			),
		),
		'pax_stats'        => array(
			array( 'user_id' => 2, 'f3_name' => 'Fishstix', 'total_posts' => 900, 'qs' => 200, 'coqs' => 1, 'aos_visited' => 27, 'first_post' => '2016-01-01', 'last_post' => '2026-10-20', 'active_months' => 100, 'current_streak' => 86, 'max_streak' => 137 ),
			array( 'user_id' => 1, 'f3_name' => 'Dojo', 'total_posts' => 557, 'qs' => 43, 'coqs' => 1, 'aos_visited' => 25, 'first_post' => '2020-01-01', 'last_post' => '2026-10-16', 'active_months' => 60, 'current_streak' => 54, 'max_streak' => 54 ),
		),
		'pax_top_aos'      => array(
			array( 'user_id' => 1, 'ao_name' => 'Dawn Patrol', 'posts' => 104, 'qs' => 13, 'rn' => 1 ),
			array( 'user_id' => 1, 'ao_name' => 'The Yard', 'posts' => 72, 'qs' => 5, 'rn' => 2 ),
			array( 'user_id' => 2, 'ao_name' => 'Sweep the Leg', 'posts' => 300, 'qs' => 60, 'rn' => 1 ),
		),
		'ao_data'          => array(
			'all_time' => array( array( 'ao_id' => 7, 'ao_name' => 'The Yard', 'workouts' => 300, 'pax_posts' => 3000, 'unique_pax' => 200, 'avg_pax' => 10.0 ) ),
			'ytd'      => array( array( 'ao_id' => 7, 'ao_name' => 'The Yard', 'workouts' => 37, 'pax_posts' => 354, 'unique_pax' => 58, 'avg_pax' => 9.6 ) ),
		),
		'ao_top_attendees' => array( 'ytd' => array( array( 'ao_id' => 7, 'ao_name' => 'The Yard', 'user_id' => 1, 'f3_name' => 'Dojo', 'posts' => 9, 'qs' => 1, 'rn' => 1 ) ) ),
		'ao_monthly_trend' => array(
			array( 'ao_id' => 7, 'ao_name' => 'The Yard', 'month' => '2026-09', 'workouts' => 4, 'pax_posts' => 40, 'unique_pax' => 20 ),
			array( 'ao_id' => 7, 'ao_name' => 'The Yard', 'month' => '2026-10', 'workouts' => 2, 'pax_posts' => 18, 'unique_pax' => 12 ),
		),
		'ao_no_q'          => array( array( 'ao_id' => 7, 'user_id' => 3, 'f3_name' => 'Time Machine', 'posts' => 6 ) ),
	);
}

fortw_test(
	'Views: leaderboard ranks, Q sort, Q% and search keep ranks',
	function () {
		$core = fstats_test_core();
		$rows = fstats_rank_rows( $core['leaderboards']['ytd'] );
		assert_same( array( 1, 2, 3 ), array_column( $rows, 'rank' ) );
		assert_same( array( 10, 50, 0 ), array_column( $rows, 'q_pct' ) );
		assert_same( array( 'Fishstix', 'Dojo', 'Time Machine' ), array_column( fstats_rank_rows( $core['leaderboards']['ytd'], 'qs' ), 'f3_name' ) );
		$found = fstats_search_rows( $rows, 'time' );
		assert_same( array( array( 'Time Machine', 3 ) ), array_map( fn( $r ) => array( $r['f3_name'], $r['rank'] ), $found ) );
		assert_same( 3, count( fstats_search_rows( $rows, '  ' ) ) );
	}
);

fortw_test(
	'Views: one PAX — stats, top AOs, ranks per window, milestones',
	function () {
		$p = fstats_pax_detail( fstats_test_core(), 1 );
		assert_same( 'Dojo', $p['f3_name'] );
		assert_same( array( 'Dawn Patrol', 'The Yard' ), array_column( $p['top_aos'], 'ao_name' ) );
		assert_same( array( 'ytd' => 1, 'all_time' => 2 ), $p['ranks'] );
		assert_same( array( 25, 50, 100, 150, 200, 250, 300, 400, 500 ), $p['milestones'] );
		assert_same( null, fstats_pax_detail( fstats_test_core(), 99 ) );
		assert_same( array( 1 => 'Dawn Patrol', 2 => 'Sweep the Leg' ), fstats_home_aos( fstats_test_core()['pax_top_aos'] ) );
	}
);

fortw_test(
	'Views: one AO — windows, a 12-month series with gaps filled, top attendees, most posts without a Q',
	function () {
		$a = fstats_ao_detail( fstats_test_core(), 7, '2026-10-22' );
		assert_same( 'The Yard', $a['ao_name'] );
		assert_same( array( 'ytd', 'all_time' ), array_keys( $a['windows'] ), 'in display order' );
		assert_same( 12, count( $a['months'] ) );
		assert_same( array( '2025-11', 0 ), array( array_key_first( $a['months'] ), reset( $a['months'] ) ) );
		assert_same( array( 40, 18 ), array_slice( array_values( $a['months'] ), -2 ) );
		assert_same( 'Dojo', $a['top']['ytd'][0]['f3_name'] );
		assert_same( 'Time Machine', $a['no_q']['f3_name'] );
		assert_same( null, fstats_ao_detail( fstats_test_core(), 8, '2026-10-22' ) );
	}
);

fortw_test(
	'Views: streak lists (active only if current > 0), month helpers, bars',
	function () {
		$rows  = array(
			array( 'user_id' => 1, 'current_streak' => 0, 'max_streak' => 40 ),
			array( 'user_id' => 2, 'current_streak' => 5, 'max_streak' => 9 ),
			array( 'user_id' => 9, 'current_streak' => 50, 'max_streak' => 50 ), // Unknown PAX: skipped.
		);
		$lists = fstats_streak_lists( $rows, array( 1 => 'Dojo', 2 => 'Fishstix' ) );
		assert_same( array( 'Fishstix' ), array_column( $lists['active'], 'f3_name' ) );
		assert_same( array( 'Dojo', 'Fishstix' ), array_column( $lists['record'], 'f3_name' ) );
		assert_same( array( '2025-12', '2026-01', '2026-02' ), fstats_last_months( '2026-02-10', 3 ) );
		assert_same( 'Oct 2026', fstats_month_label( '2026-10' ) );
		assert_same( 'October 2026', fstats_month_label( '2026-10', true ) );
		assert_same( array( 50.0, 0, 100 ), array( fstats_pct( 5, 10 ), fstats_pct( 5, 0 ), fstats_pct( 20, 10 ) ) );
		assert_same( array( 'Block Party', 'The Yard' ), array_column( fstats_sort_aos( array( array( 'ao_name' => 'The Yard', 'workouts' => 3 ), array( 'ao_name' => 'Block Party', 'workouts' => 5 ) ), 'workouts' ), 'ao_name' ) );
	}
);
