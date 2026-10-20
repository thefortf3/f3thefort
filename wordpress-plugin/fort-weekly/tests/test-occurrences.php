<?php
// Dates, occurrences and lifecycle — same cases as the newsletter app's tests/entries.unit.js.

fortw_test(
	'today is read in the region timezone, not UTC',
	function () {
		// 2026-10-21 02:30 UTC is still the evening of Oct 20 in New York.
		assert_same( '2026-10-20', fortw_today( gmmktime( 2, 30, 0, 10, 21, 2026 ) ) );
		assert_same( '2026-10-21', fortw_today( gmmktime( 12, 0, 0, 10, 21, 2026 ) ) );
	}
);

fortw_test(
	'add days crosses months, years and DST',
	function () {
		assert_same( '2026-11-02', fortw_add_days( '2026-10-27', 6 ) );
		assert_same( '2027-01-01', fortw_add_days( '2026-12-31', 1 ) );
		assert_same( '2026-10-14', fortw_add_days( '2026-10-20', -6 ) );
		assert_same( '2026-11-02', fortw_add_days( '2026-11-01', 1 ) ); // DST ends Nov 1 in New York.
	}
);

fortw_test(
	'iso dates must be real calendar dates',
	function () {
		assert_true( fortw_is_iso_date( '2026-02-28' ) );
		assert_true( fortw_is_iso_date( '2028-02-29' ) );
		assert_true( ! fortw_is_iso_date( '2026-02-30' ) );
		assert_true( ! fortw_is_iso_date( '2026-2-3' ) );
		assert_true( ! fortw_is_iso_date( '2026-10-20T05:15' ) );
		assert_true( ! fortw_is_iso_date( null ) );
	}
);

fortw_test(
	'occurrences are validated, de-duplicated and sorted',
	function () {
		$out = fortw_normalize_occurrences(
			array(
				array( 'date' => '2026-11-07', 'start_time' => '0730' ),
				array( 'date' => ' 2026-10-24 ', 'start_time' => '0730', 'end_time' => '' ),
				array( 'date' => '2026-10-24', 'start_time' => '0730' ),
				array( 'date' => '2026-10-24', 'start_time' => '0600' ),
			)
		);
		assert_same(
			array(
				array( 'date' => '2026-10-24', 'start_time' => '0600', 'end_time' => null ),
				array( 'date' => '2026-10-24', 'start_time' => '0730', 'end_time' => null ),
				array( 'date' => '2026-11-07', 'start_time' => '0730', 'end_time' => null ),
			),
			$out
		);
		assert_throws( function () { fortw_normalize_occurrences( array( array( 'date' => '2026-13-01' ) ) ); } );
		assert_throws( function () { fortw_normalize_occurrences( 'nope' ); } );
		assert_same( 40, strlen( fortw_normalize_occurrences( array( array( 'date' => '2026-10-24', 'start_time' => str_repeat( 'x', 99 ) ) ) )[0]['start_time'] ) );
	}
);

fortw_test(
	'next occurrence and lifecycle',
	function () {
		$occ = array( array( 'date' => '2026-10-10', 'start_time' => null, 'end_time' => null ), array( 'date' => '2026-10-24', 'start_time' => '0730', 'end_time' => null ) );
		assert_same( '2026-10-24', fortw_next_occurrence( $occ, '2026-10-20' )['date'] );
		assert_same( '2026-10-24', fortw_next_occurrence( $occ, '2026-10-24' )['date'], 'today counts as upcoming' );
		assert_same( null, fortw_next_occurrence( $occ, '2026-10-25' ) );

		$e = array( 'status' => 'approved', 'archived' => false, 'occurrences' => $occ );
		assert_same( 'upcoming', fortw_lifecycle( $e, '2026-10-20' ) );
		assert_same( 'past', fortw_lifecycle( $e, '2026-10-25' ) );
		assert_same( 'ongoing', fortw_lifecycle( array_merge( $e, array( 'occurrences' => array() ) ), '2026-10-20' ) );
		assert_same( 'pending', fortw_lifecycle( array_merge( $e, array( 'status' => 'pending' ) ), '2026-10-20' ) );
		assert_same( 'rejected', fortw_lifecycle( array_merge( $e, array( 'status' => 'rejected' ) ), '2026-10-20' ) );
		assert_same( 'archived', fortw_lifecycle( array_merge( $e, array( 'archived' => true, 'status' => 'pending' ) ), '2026-10-20' ) );
	}
);

fortw_test(
	'next-date key sorts upcoming, then ongoing, then past',
	function () {
		$occ = array( array( 'date' => '2026-10-24', 'start_time' => null, 'end_time' => null ) );
		assert_same( '2026-10-24', fortw_next_date_key( $occ, '2026-10-20' ) );
		assert_same( '0000-00-00', fortw_next_date_key( $occ, '2026-10-25' ) );
		assert_same( '9999-12-31', fortw_next_date_key( array(), '2026-10-20' ) );
	}
);

fortw_test(
	'entries sort by next occurrence, then ongoing, then past (most recent first)',
	function () {
		$mk = function ( $title, $occ, $today = '2026-10-20' ) {
			$occ = array_map( function ( $d ) { return array( 'date' => $d[0], 'start_time' => $d[1], 'end_time' => null ); }, $occ );
			return array( 'title' => $title, 'occurrences' => $occ, 'next_occurrence' => fortw_next_occurrence( $occ, $today ) );
		};
		$list = array(
			$mk( 'Old past', array( array( '2026-09-01', null ) ) ),
			$mk( 'Ongoing B', array() ),
			$mk( 'Later', array( array( '2026-11-05', '1730' ) ) ),
			$mk( 'Recent past', array( array( '2026-10-01', null ) ) ),
			$mk( 'Soon late', array( array( '2026-10-24', '1100' ) ) ),
			$mk( 'Soon early', array( array( '2026-10-24', '0730' ) ) ),
			$mk( 'Ongoing A', array() ),
		);
		usort( $list, 'fortw_compare_entries' );
		assert_same(
			array( 'Soon early', 'Soon late', 'Later', 'Ongoing A', 'Ongoing B', 'Recent past', 'Old past' ),
			array_column( $list, 'title' )
		);
	}
);

fortw_test(
	'old single-date columns become one occurrence, including ISO datetimes',
	function () {
		assert_same( array( 'date' => '2026-10-24', 'start_time' => '0915', 'end_time' => null ), fortw_legacy_to_occurrence( '2026-10-24', '0915', null ) );
		assert_same( array( 'date' => '2026-06-14', 'start_time' => '0530', 'end_time' => '06:30' ), fortw_legacy_to_occurrence( '2026-06-14T05:30', null, '2026-06-14T06:30' ) );
		assert_same( null, fortw_legacy_to_occurrence( '', null, null ) );
		assert_same( null, fortw_legacy_to_occurrence( 'next week', null, null ) );
	}
);
