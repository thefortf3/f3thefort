<?php
/**
 * Times in F3's 24-hour form, and "Add to calendar" (.ics and Google links).
 *
 * @package FortWeekly
 */

fortw_test(
	'times: whatever was typed becomes 24-hour HHMM; what can’t be read is null',
	function () {
		$cases = array(
			'0800' => '0800', '08:00' => '0800', '800' => '0800', '8' => '0800', '8am' => '0800', '8 AM' => '0800',
			'6:30am' => '0630', '8:30' => '0830', '17:30' => '1730', '0900 Hours (Race/Walk/Ruck Begins)' => '0900',
			'12pm' => '1200', '12am' => '0000', '12:30 a.m.' => '0030', 'noon' => '1200', '1:15 PM' => '1315',
			'TBD' => null, '25:00' => null, '13pm' => null, '' => null,
		);
		foreach ( $cases as $typed => $want ) {
			assert_same( $want, fortw_parse_time( (string) $typed ), (string) $typed );
		}
	}
);

fortw_test(
	'times: a range in one box, and an am/pm typed once, read for both ends',
	function () {
		assert_same( array( '1730', '1930' ), fortw_parse_time_range( '1730–1930' ) );
		assert_same( array( '1800', '1900' ), fortw_parse_time_range( '6-7pm' ) );
		assert_same( array( '1100', '1300' ), fortw_parse_time_range( '11-1pm' ) );
		assert_same( array( '1830', '1930' ), fortw_parse_time_range( '6:30', '7:30pm' ) );
		assert_same( array( '0800', '0945' ), fortw_parse_time_range( '8:00 am', '09:45' ) );
		assert_same( array( '1100', null ), fortw_parse_time_range( '1100' ) );
	}
);

fortw_test(
	'saving dates: times converted; unreadable kept as typed; 0000 alone, 0000–2359 or start = end tidied',
	function () {
		$out = fortw_normalize_occurrences(
			array(
				array( 'date' => '2026-11-09', 'start_time' => '6-7pm' ),
				array( 'date' => '2026-11-06', 'start_time' => '00:00', 'end_time' => '23:59' ),
				array( 'date' => '2026-11-07', 'start_time' => 'TBD', 'end_time' => 'late' ),
				array( 'date' => '2026-11-08', 'start_time' => '1805', 'end_time' => '18:05' ),
			)
		);
		assert_same(
			array(
				array( 'date' => '2026-11-06', 'start_time' => null, 'end_time' => null ),
				array( 'date' => '2026-11-07', 'start_time' => 'TBD', 'end_time' => 'late' ),
				array( 'date' => '2026-11-08', 'start_time' => '1805', 'end_time' => null ),
				array( 'date' => '2026-11-09', 'start_time' => '1800', 'end_time' => '1900' ),
			),
			$out
		);
	}
);

fortw_test(
	'calendar: Eastern time written as UTC (EDT and EST), an hour without an end, all-day without a time, past midnight',
	function () {
		$span = function ( $date, $s, $e = null ) {
			$x = fortw_cal_span( array( 'date' => $date, 'start_time' => $s, 'end_time' => $e ) );
			return $x['all_day'] ? 'all day ' . $x['start']->format( 'Ymd' ) . '–' . $x['end']->format( 'Ymd' ) : $x['start']->setTimezone( new DateTimeZone( 'UTC' ) )->format( 'Ymd\THi' ) . '–' . $x['end']->setTimezone( new DateTimeZone( 'UTC' ) )->format( 'Ymd\THi' );
		};
		assert_same( '20261019T0915–20261019T1015', $span( '2026-10-19', '0515' ), 'EDT, an hour long' );
		assert_same( '20261205T1330–20261205T1430', $span( '2026-12-05', '0830' ), 'EST' );
		assert_same( '20261106T2300–20261107T0200', $span( '2026-11-06', '1800', '2100' ) );
		assert_same( '20261231T0300–20261231T0600', $span( '2026-12-30', '2200', '0100' ), 'ends the next morning' );
		assert_same( 'all day 20261107–20261108', $span( '2026-11-07', null ) );
		assert_same( 'all day 20261107–20261108', $span( '2026-11-07', 'TBD' ), 'unreadable: all day, never a wrong time' );
	}
);

fortw_test(
	'calendar: the .ics has one event per date, escaped and folded; the Google link fills the form',
	function () {
		$e   = array( 'id' => 7, 'title' => 'Beers, Bets; & Brats', 'location' => 'The Hive, Fort Mill', 'summary' => "Line one\nline two", 'url' => 'https://x/events/b/' );
		$ics = fortw_ics( $e, array( array( 'date' => '2026-11-06', 'start_time' => '1800', 'end_time' => '2100' ), array( 'date' => '2026-11-13', 'start_time' => null, 'end_time' => null ) ), 1792800000, 'x' );
		assert_same( 2, substr_count( $ics, 'BEGIN:VEVENT' ) );
		assert_true( false !== strpos( $ics, "UID:fortw-7-20261106@x\r\nDTSTAMP:" ), 'stable UIDs' );
		assert_true( false !== strpos( $ics, "DTSTART:20261106T230000Z\r\nDTEND:20261107T020000Z\r\n" ) );
		assert_true( false !== strpos( $ics, "DTSTART;VALUE=DATE:20261113\r\nDTEND;VALUE=DATE:20261114\r\n" ) );
		assert_true( false !== strpos( $ics, 'SUMMARY:Beers\, Bets\; & Brats' ) && false !== strpos( $ics, 'LOCATION:The Hive\, Fort Mill' ) && false !== strpos( $ics, 'Line one\nline two\n\nhttps://x/events/b/' ) );
		foreach ( explode( "\r\n", $ics ) as $line ) {
			assert_true( strlen( $line ) <= 75, 'folded: ' . $line );
		}
		$g = fortw_google_calendar_url( $e, array( 'date' => '2026-11-06', 'start_time' => '1800', 'end_time' => '2100' ) );
		assert_true( 0 === strpos( $g, 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=Beers%2C%20Bets%3B%20%26%20Brats&dates=20261106T180000%2F20261106T210000' ), $g );
		assert_true( false !== strpos( $g, '&ctz=America%2FNew_York' ) && false !== strpos( $g, '&location=The%20Hive%2C%20Fort%20Mill' ) );
		assert_true( false !== strpos( fortw_google_calendar_url( $e, array( 'date' => '2026-11-13', 'start_time' => null ) ), 'dates=20261113%2F20261114&' ), 'all day' );
	}
);
