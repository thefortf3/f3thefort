<?php
// Payload builders — the cases of the stats repo's tests/test_backblast_payload.py, plus streaks,
// windows, the sparkline and the FNG sheet.

/** A stub source answering the calls those tests make (other methods return empty data). */
class FStats_Test_Source implements FStats_Source {
	public $calls = array();

	public function recent_workouts( string $start_date, ?string $end_date = null, int $limit = 12 ): array {
		$this->calls[] = array( 'recent_workouts', $start_date, $end_date, $limit );
		$rows          = array(
			array(
				'event_instance_id' => 2, 'start_date' => '2026-10-19', 'ao_name' => 'The Armory', 'location_name' => 'Armory Park',
				'pax_count' => 4, 'fng_count' => 1, 'qs' => array( 'Brawny', null ), 'title' => ' 50 Caliber ',
				'backblast' => "Backblast! 50 Caliber\nDate: 2026-10-19\nAO: The Armory\nQ: Brawny , \nPAX: Brawny, Bam Bam\nFNGs: Teflon\nCOUNT: 4\n\nWARMUP: SSH x20.\nTHE THANG: coupons.",
			),
			array( 'event_instance_id' => 1, 'start_date' => '2026-10-18', 'ao_name' => 'Dawn Patrol', 'location_name' => null, 'pax_count' => null, 'fng_count' => null, 'qs' => array() ),
		);
		return array_slice( $rows, 0, $limit );
	}
	public function summary( ?string $start_date = null, ?string $end_date = null ): array {
		$this->calls[] = array( 'summary', $start_date, $end_date );
		return array( 'workouts' => 21, 'pax_posts' => 203, 'unique_pax' => 126, 'unique_qs' => 19 );
	}
	public function weekly_posts( ?string $start_date = null, ?string $end_date = null ): array {
		$out = array();
		for ( $n = 30; $n <= 40; $n++ ) {
			$out[] = array( 'week' => sprintf( '2026-W%02d', $n ), 'workouts' => 20, 'pax_posts' => 200 + $n );
		}
		return $out;
	}
	public function search_backblasts( ?string $ao = null, ?string $month = null, ?string $q = null, ?string $workout_type = null, int $limit = 24, int $offset = 0 ): array {
		$this->calls[] = array( 'search_backblasts', $ao, $month, $q, $workout_type, $limit, $offset );
		return array(
			'total' => 49,
			'rows'  => array(
				array(
					'event_instance_id' => 9, 'start_date' => '2026-10-20', 'start_time' => '05:15:00', 'ao_name' => 'Block Party',
					'location_name' => 'Walter Elisha', 'pax_count' => 7, 'fng_count' => 0, 'title' => 'Mozy Ruck 4 ',
					'backblast' => "Backblast! Mozy Ruck 4\nQ: Bam Bam\n\n" . str_repeat( 'word ', 80 ), 'workout_types' => array( 'Ruck', null ), 'qs' => array( 'Bam Bam' ),
				),
			),
		);
	}
	public function backblast_filters(): array {
		return array( 'aos' => array( array( 'name' => 'Block Party', 'n' => 120 ) ), 'months' => array( array( 'month' => '2026-10', 'n' => 80 ) ), 'types' => array( array( 'name' => 'Ruck', 'n' => 9 ) ) );
	}
	public function backblast( int $event_instance_id ): ?array {
		if ( 9 !== $event_instance_id ) {
			return null;
		}
		return array(
			'event_instance_id' => 9, 'start_date' => '2026-10-20', 'start_time' => '0515', 'ao_name' => 'Block Party',
			'location_name' => null, 'pax_count' => 3, 'fng_count' => 1, 'title' => 'Mozy Ruck 4',
			'backblast' => "Backblast! Mozy Ruck 4\nDate: 2026-10-20\nAO: Block Party\nQ: Bam Bam ,\nPAX: Bam Bam, Ski, Teflon\n\nWarmup: SSH.\n\nThe thang:\nRuck 3 miles.\n\nCOT: prayers.",
			'workout_types' => array( 'Ruck' ), 'qs' => array( 'Bam Bam' ), 'coqs' => array(), 'pax' => array( 'Bam Bam', 'Ski', 'Teflon' ),
		);
	}
	public function ao_breakdown( ?string $start_date = null, ?string $end_date = null ): array {
		return array_map( fn( $p ) => array( 'ao_name' => $p[0], 'pax_posts' => $p[1] ), array( array( 'Dawn Patrol', 20 ), array( 'Minnow Pond', 19 ), array( '6 @ 6', 16 ), array( 'Other', 3 ) ) );
	}
	public function active_ao_names(): array {
		return array( 'Alcatraz', 'Block Party', 'Q Source', 'The Hive' );
	}

	public function region_name(): string { return 'The Fort'; }
	public function sync_status(): array { return array(); }
	public function available_months( int $limit = 24 ): array { return array(); }
	public function attendance_leaderboard( ?string $start_date = null, ?string $end_date = null, int $top_n = 25 ): array { return array(); }
	public function ao_top_attendees( int $top_n_per_ao = 15, ?string $start_date = null, ?string $end_date = null ): array { return array(); }
	public function ao_most_posts_no_q( string $start_date ): array { return array(); }
	public function monthly_trend( ?string $start_date = null, ?string $end_date = null ): array { return array(); }
	public function ao_monthly_trend( ?string $start_date = null, ?string $end_date = null ): array { return array(); }
	public function all_pax_stats(): array { return array(); }
	public function pax_top_aos( int $top_n_per_pax = 5 ): array { return array(); }
	public function pax_weekly_activity(): array { return array(); }
	public function pax_monthly_activity(): array { return array(); }
	public function pax_q_weekly_activity(): array { return array(); }
	public function pax_double_weekly_activity(): array { return array(); }
	public function pax_dow_weekly_activity( int $dow ): array { return array(); }
	public function pax_home_ao_weekly_activity(): array { return array(); }
}

class FStats_Test_Schedule implements FStats_Schedule {
	public $dates = array();

	public function get_ao_details( bool $active_only = true ): array {
		return array(
			'aos' => array(
				array( 'name' => 'Dawn Patrol', 'site_qs' => array( array( 'f3_name' => 'Minuteman' ), array( 'f3_name' => 'Old Bay' ) ) ),
				array( 'name' => 'The Hive', 'site_qs' => array( array( 'f3_name' => 'Small Things' ) ) ),
				array( 'name' => 'Old AO', 'shutdown_date' => '2026-10-01T00:00:00Z' ),
			),
		);
	}
	public function get_scheduled_qs( string $date ): array {
		$this->dates[] = $date;
		if ( '2026-10-21' !== $date ) {
			return array( 'scheduled_events' => array() );
		}
		return array(
			'scheduled_events' => array(
				array( 'ao_name' => 'The Hive', 'event_type' => '1stF Workout', 'start_time' => '05:30:00', 'qs' => array( array( 'f3_name' => 'Bread Maker', 'status' => 'confirmed' ) ) ),
				array( 'ao_name' => 'Dawn Patrol ', 'event_type' => '1stF Workout', 'start_time' => '5:15', 'qs' => array( array( 'f3_name' => 'Ruby Slippers' ), array( 'f3_name' => 'Cyclops' ) ) ),
				array( 'ao_name' => 'Closed AO', 'event_type' => '1stF Workout', 'start_time' => '05:30', 'qs' => array() ),
				array( 'ao_name' => 'Old AO', 'event_type' => '1stF Workout', 'start_time' => '05:30', 'qs' => array( array( 'f3_name' => 'Ghost' ) ) ),
				array( 'ao_name' => 'The Testament', 'event_type' => '3rdF', 'start_time' => '0630', 'qs' => array( array( 'f3_name' => 'Cornerstone' ) ) ),
			),
		);
	}
}

fortw_test(
	'Backblasts feed: shape and window',
	function () {
		$db  = new FStats_Test_Source();
		$out = fstats_backblasts_payload( $db, 7, 12, '2026-10-20' );
		assert_same( '2026-10-13', $out['from'] );
		assert_same( '2026-10-20', $out['to'] );
		assert_same( array( 'recent_workouts', '2026-10-13', '2026-10-20', 12 ), $db->calls[0] );
		list( $first, $second ) = $out['items'];
		assert_same(
			array( 'event_id' => 2, 'date' => '2026-10-19', 'ao' => 'The Armory', 'location' => 'Armory Park', 'pax_count' => 4, 'fng_count' => 1, 'qs' => array( 'Brawny' ), 'title' => '50 Caliber', 'excerpt' => 'WARMUP: SSH x20. THE THANG: coupons.' ),
			$first
		);
		assert_same( array( null, '' ), array( $second['title'], $second['excerpt'] ) );
		assert_same( array( 0, 0, array() ), array( $second['pax_count'], $second['fng_count'], $second['qs'] ) );
	}
);

fortw_test(
	'Backblast summary: the last seven days ending yesterday',
	function () {
		$out = fstats_backblast_summary_payload( new FStats_Test_Source(), '2026-10-20' );
		assert_same( array( '2026-10-13', '2026-10-19' ), array( $out['from'], $out['to'] ) );
		assert_same( array( 21, 203, 126, 1 ), array( $out['workouts'], $out['pax_posts'], $out['unique_pax'], $out['fngs'] ) );
		assert_same( 8, count( $out['weekly_trend'] ) );
		assert_same( array( 'week' => '2026-W40', 'posts' => 240 ), end( $out['weekly_trend'] ) );
		assert_same( array( array( 'ao' => 'Dawn Patrol', 'posts' => 20 ), array( 'ao' => 'Minnow Pond', 'posts' => 19 ), array( 'ao' => '6 @ 6', 'posts' => 16 ) ), $out['top_aos'] );
		assert_same( 'generated_at', array_key_last( $out ), 'generated_at is added last, as in Python' );
	}
);

fortw_test(
	'Schedule: days, times, filters, and site Qs for scheduled AOs only',
	function () {
		$gs  = new FStats_Test_Schedule();
		$out = fstats_schedule_payload( $gs, 3, '2026-10-20' );
		assert_true( $out['configured'] );
		assert_same( array( '2026-10-20', '2026-10-21', '2026-10-22' ), $gs->dates );
		assert_same( array( '2026-10-20', '2026-10-22' ), array( $out['from'], $out['to'] ) );
		$day = $out['days'][1];
		assert_same(
			array( array( '0515', 'Dawn Patrol', array( 'Ruby Slippers', 'Cyclops' ) ), array( '0530', 'The Hive', array( 'Bread Maker' ) ), array( '0630', 'The Testament', array( 'Cornerstone' ) ) ),
			array_map( fn( $w ) => array( $w['start_time'], $w['ao'], $w['qs'] ), $day['workouts'] )
		);
		assert_same( array( true, true, false ), array_column( $day['workouts'], 'is_workout' ) );
		assert_same( array( 'Dawn Patrol' => array( 'site_qs' => array( 'Minuteman', 'Old Bay' ) ), 'The Hive' => array( 'site_qs' => array( 'Small Things' ) ), 'The Testament' => array( 'site_qs' => array() ) ), $out['aos'] );
		$none = fstats_schedule_payload( null, 7, '2026-10-20' );
		assert_same( array( false, array() ), array( $none['configured'], $none['days'] ) );
	}
);

fortw_test(
	'Archive: header lines dropped, excerpt cut on a word',
	function () {
		list( $body, $excerpt ) = fstats_backblast_body( "Backblast! T\r\nDate: x\nAO: y\nQ: z\nCo-Q: w\nPAX: a, b\nFNG: none\nCOUNT: 2\n\nReal text here." );
		assert_same( 'Real text here.', $body );
		assert_same( 'Real text here.', $excerpt );
		$long = fstats_backblast_body( str_repeat( 'word ', 80 ) )[1];
		assert_true( str_ends_with( $long, '…' ) && mb_strlen( $long ) <= 221, $long );
		assert_same( array( '', '' ), fstats_backblast_body( null ) );
	}
);

fortw_test(
	'Archive: page, filters and choices; a malformed month is ignored',
	function () {
		$db  = new FStats_Test_Source();
		$out = fstats_backblast_archive_payload( $db, 3, 24, 'Block Party', '2026-10', 'ruck', 'Ruck' );
		assert_same( array( 'search_backblasts', 'Block Party', '2026-10', 'ruck', 'Ruck', 24, 48 ), $db->calls[0] );
		assert_same( array( 49, 3, 3 ), array( $out['total'], $out['pages'], $out['page'] ) );
		$item = $out['items'][0];
		assert_same( array( 'Mozy Ruck 4', '0515', array( 'Ruck' ), array( 'Bam Bam' ) ), array( $item['title'], $item['start_time'], $item['types'], $item['qs'] ) );
		assert_true( str_starts_with( $item['excerpt'], 'word word' ) && str_ends_with( $item['excerpt'], '…' ) );
		assert_same( 'Block Party', $out['choices']['aos'][0]['name'] );
		fstats_backblast_archive_payload( $db, 1, 24, '', 'Oct 2026' );
		assert_same( null, end( $db->calls )[2] );
	}
);

fortw_test(
	'Detail: paragraphs and people; unknown ids are null',
	function () {
		$out = fstats_backblast_detail_payload( new FStats_Test_Source(), 9 )['item'];
		assert_same( array( 'Warmup: SSH.', "The thang:\nRuck 3 miles.", 'COT: prayers.' ), $out['paragraphs'] );
		assert_same( array( array( 'Bam Bam', 'Ski', 'Teflon' ), array( 'Bam Bam' ), 1 ), array( $out['pax'], $out['qs'], $out['fng_count'] ) );
		assert_same( null, fstats_backblast_detail_payload( new FStats_Test_Source(), 10 ) );
	}
);

fortw_test(
	'Streaks: consecutive weeks across a year end, grace periods, longest vs current',
	function () {
		assert_true( fstats_weeks_consecutive( 202552, 202601 ) );
		assert_true( fstats_weeks_consecutive( 202651, 202701 ), 'a 52-week year' );
		assert_true( ! fstats_weeks_consecutive( 202550, 202601 ) );
		assert_true( fstats_months_consecutive( 202512, 202601 ) );
		$today = '2026-10-21'; // ISO week 2026-W43.
		$rows  = fstats_compute_streaks(
			array(
				7 => array( '2026-W39', '2026-W40', '2026-W41' ),            // last post 2 weeks ago: still current (grace 2)
				8 => array( '2026-W10', '2026-W11', '2026-W12', '2026-W13' ), // long gone: current 0, longest 4
				9 => array( '2026-W43' ),
			),
			$today
		);
		assert_same(
			array( array( 'user_id' => 7, 'current_streak' => 3, 'max_streak' => 3 ), array( 'user_id' => 9, 'current_streak' => 1, 'max_streak' => 1 ), array( 'user_id' => 8, 'current_streak' => 0, 'max_streak' => 4 ) ),
			$rows
		);
		$m = fstats_compute_streaks( array( 1 => array( '2026-08', '2026-09' ), 2 => array( '2026-07' ) ), $today, 'month' );
		assert_same( array( 2, 0 ), array( $m[0]['current_streak'], $m[1]['current_streak'] ) );
	}
);

fortw_test(
	'Windows and month bounds',
	function () {
		assert_same( array( 'ytd' => '2026-01-01', 'last90' => '2026-07-23', 'last30' => '2026-09-21', 'year' => '2025-10-21' ), fstats_windows( '2026-10-21' ) );
		assert_same( array( '2024-02-01', '2024-02-29' ), fstats_month_bounds( '2024-02' ) );
		assert_same( null, fstats_month_payload( new FStats_Test_Source(), '2026-13' ) );
		assert_same( null, fstats_month_payload( new FStats_Test_Source(), 'oct' ) );
	}
);

fortw_test(
	'Sparkline: the same SVG text as Python (half-to-even rounding, Python float printing)',
	function () {
		// From web/payload.py _sparkline_svg([3, 6, 0, 12, 5, 5, 8, 1, 2, 9, 10, 11]).
		$svg = fstats_sparkline_svg( array( 3, 6, 0, 12, 5, 5, 8, 1, 2, 9, 10, 11 ) );
		assert_true( str_starts_with( $svg, '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="24" style="display:block"><rect x="0.0" y="18" width="5.8" height="6" rx="1" fill="#4f8ef7" opacity="0.8"/><rect x="6.8" y="12"' ), $svg );
		assert_true( false !== strpos( $svg, '<rect x="20.2" y="0" width="5.8" height="24"' ), 'x=20.25 rounds to 20.2, as in Python' );
		assert_same( '<svg width="80" height="24"></svg>', fstats_sparkline_svg( array() ) );
	}
);

fortw_test(
	'FNG sheet: parsing, AO aliases, window and per-AO board',
	function () {
		$csv  = "Timestamp,First Name,Last Name,Email,F3 Name,EH'ed By,Workout Q's F3 Name,AO,Phone Number\n"
			. "9/3/2026 6:12:01,A,B,a@x,Teflon,Stang,Bam Bam,Dawn Patrol (Tue),1\n"
			. "9/1/2026 6:00:00,C,D,c@x,,  Stang ,Q,blockparty,2\n"
			. "bad date,E,F,e@x,Nope,,,Alcatraz,3\n"
			. "\"10/2/2026 6:00:00\",G,H,g@x,\"Name, With Comma\",Poppins,Q,,4\n";
		$r    = fstats_parse_fng_csv( $csv );
		assert_same( array( '2026-09-01', '2026-09-03', '2026-10-02' ), array_column( $r, 'date' ) );
		assert_same( array( 'Block Party', 'Dawn Patrol', '' ), array_column( $r, 'ao' ) );
		assert_same( 'Name, With Comma', $r[2]['f3_name'] );
		$board = fstats_fng_challenge_payload( new FStats_Test_Source(), $r, '2026-09-01', '2026-09-30' );
		assert_same( array( 2, 1, 1, 0 ), array( $board['total_fngs'], $board['top_ehers'][0]['count'] - 1, $board['participating_aos'] - 1, $board['unattributed'] ) );
		assert_same( array( 'Block Party', 'Dawn Patrol', 'Alcatraz', 'The Hive' ), array_column( $board['aos'], 'ao' ), 'scored AOs first, Q Source left off' );
		assert_same( '(unnamed)', $board['aos'][0]['fngs'][0]['f3_name'] );
		assert_same( 'September 2026', $board['month_label'] );
		$f = fstats_fng_payload( $r, '2026-10-21' );
		assert_same( array( 3, 3, 3, 1 ), array( $f['total'], $f['ytd'], $f['last90'], $f['last30'] ) );
		assert_same( array( 'month' => '2026-09', 'count' => 2 ), $f['monthly'][0] );
		assert_same( '2026-10-02', $f['recent'][0]['date'] );
		assert_same( array( 'total' => 0 ), fstats_fng_payload( array() ) );
	}
);

fortw_test(
	'FNG sheet: per-workout counts by date and AO (any spelling), and counts in a window',
	function () {
		$r = array(
			array( 'date' => '2026-09-03', 'f3_name' => 'A', 'eh' => '', 'ao' => 'Sweep The Leg', 'q' => '' ),
			array( 'date' => '2026-09-03', 'f3_name' => 'B', 'eh' => '', 'ao' => 'sweep the leg', 'q' => '' ),
			array( 'date' => '2026-09-05', 'f3_name' => 'C', 'eh' => '', 'ao' => '6 @ 6', 'q' => '' ),
			array( 'date' => '2026-09-06', 'f3_name' => 'D', 'eh' => '', 'ao' => '', 'q' => '' ),
		);
		$by = fstats_fng_by_workout( $r );
		assert_same( 2, fstats_fng_for_workout( $by, '2026-09-03', 'Sweep the Leg' ) );
		assert_same( 1, fstats_fng_for_workout( $by, '2026-09-05', '6@6' ) );
		assert_same( 0, fstats_fng_for_workout( $by, '2026-09-04', 'Sweep the Leg' ) );
		assert_same( null, fstats_fng_for_workout( $by, '2026-09-03', null ) );
		assert_same( 3, fstats_fng_count_between( $r, '2026-09-03', '2026-09-05' ) );
	}
);
