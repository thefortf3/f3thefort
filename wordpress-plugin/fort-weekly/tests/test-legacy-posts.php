<?php
// Old backblast / pre-blast posts → records. Cases are real shapes from the site's export.

fortw_test(
	'Old posts: workout dates in every format the site used, typo\'d years ignored',
	function () {
		assert_same( '2026-10-01', fortw_lp_date( '10/01/2026', '2026-10-01 09:00:00' ) );
		assert_same( '2025-01-01', fortw_lp_date( '2025-01-01', '2025-01-02' ) );
		assert_same( '2023-03-07', fortw_lp_date( '03/07/23', '2023-03-07' ) );
		assert_same( '2015-01-05', fortw_lp_date( '1/5/15', '2015-01-05' ) );
		assert_same( null, fortw_lp_date( '', '2015-01-05' ) );
		assert_same( null, fortw_lp_date( '02/30/2020', '2020-02-28' ), 'not a real date' );
		assert_same( null, fortw_lp_date( '10/01/2062', '2026-10-01' ), 'year typo' );
		assert_same( '2027-03-01', fortw_lp_date( '03/01/2027', '' ), 'pre-blasts can be far ahead' );
	}
);

fortw_test(
	'Old posts: Q and PAX lists split into names, FNGs counted, notes dropped',
	function () {
		assert_same( array( 'Stang', 'Poppins' ), fortw_lp_names( 'Stang & Poppins' )['names'] );
		assert_same( array( 'Cake Boss', 'cousin eddie', 'jwow', 'boss hogg' ), fortw_lp_names( 'Cake Boss, cousin eddie, jwow, boss hogg' )['names'] );
		assert_same( array( 'Sweet Baby Ray' ), fortw_lp_names( 'Sweet Baby Ray' )['names'], 'spaces are part of a name' );
		$r = fortw_lp_names( "Airborne, Car Bomb, Marky Mark (FNG), Speedwalker, &amp; Trucker (FIFO)\n" );
		assert_same( array( 'Airborne', 'Car Bomb', 'Marky Mark', 'Speedwalker', 'Trucker' ), $r['names'] );
		assert_same( 1, $r['fngs'] );
		$r = fortw_lp_names( 'Red Eye, Slim Jim, FNG - Professor, red eye' );
		assert_same( array( 'Red Eye', 'Slim Jim', 'Professor' ), $r['names'] );
		assert_same( 1, $r['fngs'] );
		assert_same( array( 'Santini', 'Beacon' ), fortw_lp_names( 'Santini<br />Beacon' )['names'] );
	}
);

fortw_test(
	'Old posts: categories → AO (any spelling), topics, region-wide posts have no AO',
	function () {
		assert_same( array( 'Colosseum' ), fortw_lp_categories( array( 'The Colosseum' ) )['aos'] );
		assert_same( array( 'Colosseum' ), fortw_lp_categories( array( 'colosseum' ) )['aos'] );
		assert_same( array( "The Coach's Box" ), fortw_lp_categories( array( 'the coachs box' ) )['aos'] );
		assert_same( array( 'Snake Pit' ), fortw_lp_categories( array( 'The Snake Pit', 'snake pit' ) )['aos'] );
		assert_same( array( '6@6' ), fortw_lp_categories( array( '6at6' ) )['aos'] );
		assert_same( array( 'Golden Corral' ), fortw_lp_categories( array( 'Golden Corral' ) )['aos'], 'retired AO' );
		assert_same( array( 'Ring of Fire' ), fortw_lp_categories( array( 'Nation Ford HS Football Field (AO Ring of Fire) - 1400 AO Jones Blvd, Fort Mill, SC, 27915' ) )['aos'] );
		$c = fortw_lp_categories( array( '3rd f', 'hanging with stang', 'Pre-Blast', 'Uncategorized' ) );
		assert_same( array( 'Hanging with Stang' ), $c['aos'] );
		assert_same( array( '3rd F' ), $c['topics'] );
		assert_same( array( 'The Fort' ), fortw_lp_categories( array( 'The Fort' ) )['aos'], 'The Fort alone is the AO' );
		assert_same( array( 'Bushwood' ), fortw_lp_categories( array( 'The Fort', 'Bushwood' ) )['aos'], 'a specific AO wins' );
		assert_same( array(), fortw_lp_categories( array( 'Abyss', 'Alcatraz', 'Beyond', 'Block Party', 'The Fort' ) )['aos'], 'every AO ticked = region-wide' );
	}
);

fortw_test(
	'Old posts: write-ups lose inline colours and empty lines; Slackblast labels become headings',
	function () {
		$b = fortw_lp_body( '<span style="color: #0000ff">YHC watched</span>' . "\n\n&nbsp;\n\n<p>&nbsp;</p>" );
		assert_same( 'YHC watched', $b );
		$b = fortw_lp_body( "\nWARMUP: SSH, Windmills\nTHE THANG: \nRound 1: Cheese Shredder\nCOT: Prayers" );
		assert_true( false !== strpos( $b, '<h3 class="fort-bb-label">Warm-up</h3>' . "\n\nSSH, Windmills" ), $b );
		assert_true( false !== strpos( $b, '<h3 class="fort-bb-label">The Thang</h3>' . "\n\nRound 1: Cheese Shredder" ), 'Round 1: is not a section' );
		assert_true( false !== strpos( $b, '<h3 class="fort-bb-label">COT</h3>' ), $b );
		$b = fortw_lp_body( '<strong>WARMUP:</strong> Lap around the Skillet<br><strong>THE THANG:</strong> Abs' );
		assert_same( "<h3 class=\"fort-bb-label\">Warm-up</h3>\n\nLap around the Skillet\n\n<h3 class=\"fort-bb-label\">The Thang</h3>\n\nAbs", $b );
		$b = fortw_lp_body( "QIC: Stang\nPAX: Poppins, Slash\nGreat morning" );
		assert_same( 'Great morning', $b, 'backblast facts are shown above the write-up' );
		assert_true( false !== strpos( fortw_lp_body( "When: Saturday\nWhere: NaFo", 'preblast' ), 'When: Saturday' ), 'pre-blasts keep their details' );
		assert_same( 'Mary said hello', fortw_lp_body( 'Mary said hello' ), 'only "Mary:" at the start of a line' );
	}
);

fortw_test(
	'Old posts: a Slackblast backblast, a 2015 hand-written one, a pre-blast and an announcement',
	function () {
		$r = fortw_lp_convert(
			array(
				'title'      => 'Abs, Abs and more Abs + Communiation',
				'post_date'  => '2026-10-01 07:12:00',
				'content'    => "<strong>WARMUP:</strong> Lap around the Skillet<br><strong>THE THANG:</strong> 145 total big boys.",
				'categories' => array( 'Varsity' ),
				'tags'       => array( 'Splinter', 'Stang', 'Poppins' ),
				'meta'       => array( 'qic' => 'Splinter', 'workout_date' => '10/01/2026' ),
			)
		);
		assert_same( 'backblast', $r['kind'] );
		assert_same( '2026-10-01', $r['date'] );
		assert_same( 'Varsity', $r['ao'] );
		assert_same( array( 'Splinter' ), $r['qs'] );
		assert_same( array( 'Splinter', 'Stang', 'Poppins' ), $r['pax'] );
		assert_same( 3, $r['pax_count'] );
		assert_same( 'Lap around the Skillet 145 total big boys.', $r['excerpt'] );

		$r = fortw_lp_convert(
			array(
				'title'      => 'The Ranch - New Year&#8217;s Day',
				'post_date'  => '2015-01-01 10:00:00',
				'content'    => '<span style="color: #0000ff">YHC watched as the PAX arrived.</span>',
				'categories' => array( 'The Ranch' ),
				'tags'       => array(),
				'meta'       => array( 'qic' => 'Cake Boss', 'workout_date' => '01/01/2015', 'the_pax' => 'Santini, Beacon, MacGuyver (FNG)' ),
			)
		);
		assert_same( 'The Ranch - New Year’s Day', $r['title'] );
		assert_same( array( 'Cake Boss', 'Santini', 'Beacon', 'MacGuyver' ), $r['pax'], 'the Q counts as PAX' );
		assert_same( 1, $r['fng_count'] );
		assert_same( 'YHC watched as the PAX arrived.', $r['body_html'] );

		$r = fortw_lp_convert(
			array(
				'title'      => 'Locking Shields_3rdF Thursday',
				'post_date'  => '2023-01-02 09:33:00',
				'content'    => "PAX of The Fort,\n\nWhen: 3rd Thursday",
				'categories' => array( '3rd f', 'hanging with stang', 'Pre-Blast' ),
				'tags'       => array(),
				'meta'       => array( 'qic' => 'Cake Boss, cousin eddie', 'workout_date' => '01/19/2023' ),
			)
		);
		assert_same( 'preblast', $r['kind'] );
		assert_same( '2023-01-19', $r['date'], 'the event date' );
		assert_same( array( 'Cake Boss', 'cousin eddie' ), $r['qs'] );
		assert_same( array(), $r['pax'] );

		$r = fortw_lp_convert(
			array(
				'title'      => 'The launch of Pathfinder',
				'post_date'  => '2018-01-02 08:00:00',
				'content'    => 'What started as a need for an accountability partner…',
				'categories' => array( 'The Fort' ),
				'tags'       => array(),
				'meta'       => array(),
			)
		);
		assert_same( 'post', $r['kind'] );
		assert_same( '2018-01-02', $r['date'], 'falls back to the post date' );
	}
);
