<?php
// Newsletter rendering pieces — cases from the newsletter app's tests/newsletter-agenda.unit.js,
// plus the campaign naming. Full-issue output is checked against the app's renderAgenda with the
// parity script (see README).

fortw_test(
	'summary falls back to a word-boundary excerpt of the description; images come from hero or description',
	function () {
		assert_same( 'Short.', fortw_summary_of( array( 'summary' => 'Short.', 'description' => '' ) ) );
		$long = fortw_summary_of( array( 'summary' => '', 'description' => '<p>' . str_repeat( 'word ', 100 ) . '</p>' ), 40 );
		assert_true( '…' === mb_substr( $long, -1 ) && mb_strlen( $long ) <= 41, $long );
		assert_same( '/uploads/a.png', fortw_image_of( array( 'hero_image' => null, 'description' => '<p><img src="/uploads/a.png"></p>' ) ) );
		assert_same( '/uploads/h.png', fortw_image_of( array( 'hero_image' => '/uploads/h.png', 'description' => '<img src="/uploads/a.png">' ) ) );
	}
);

fortw_test(
	'featured write-up: the description in paragraphs, cut to fit, else the summary',
	function () {
		$e = array( 'summary' => 'Short.', 'description' => '<p>One &amp; two.</p><ul><li>Beer</li><li>Tacos</li></ul><p>' . str_repeat( 'word ', 100 ) . '</p><p>Never shown.</p>' );
		$w = fortw_writeup_of( $e, 200 );
		assert_same( array( 'One & two.', '• Beer', '• Tacos' ), array_slice( $w, 0, 3 ), 'paragraphs and list items' );
		assert_same( 3, count( $w ), 'three paragraphs at most' );
		$w = fortw_writeup_of( array( 'summary' => '', 'description' => '<p>Intro.</p><p>' . str_repeat( 'word ', 100 ) . '</p>' ), 200 );
		assert_same( 2, count( $w ) );
		assert_true( '…' === mb_substr( $w[1], -1 ) && mb_strlen( $w[0] . $w[1] ) <= 201, 'cut to the budget' );
		assert_same( array( 'Intro.' ), fortw_writeup_of( array( 'summary' => '', 'description' => '<p>Intro.</p><p>' . str_repeat( 'word ', 100 ) . '</p>' ), 40 ), 'no stub paragraph' );
		assert_same( array( 'Short.' ), fortw_writeup_of( array( 'summary' => 'Short.', 'description' => '' ) ) );
		assert_same( array( 'Line one', 'Line two' ), fortw_writeup_of( array( 'summary' => '', 'description' => "Line one\n\nLine two" ) ), 'plain text' );
	}
);

fortw_test(
	'render: escapes text, links entries to their site page, and fills the template',
	function () {
		$e    = fortw_t_entry( array( 'title' => 'Ruck <script>', 'slug' => 'ruck', 'summary' => 'A & B', 'occurrences' => array( array( 'date' => '2026-10-27', 'start_time' => '0915' ) ) ) );
		$html = fortw_render_agenda(
			'<title>{{TITLE}}</title><body>{{BODY}}</body>',
			array( $e ),
			array( 'three_fs' => array(), 'links' => array(), 'slt' => array() ),
			FORTW_T_TODAY,
			array( 'site_url' => 'https://s', 'submit_url' => 'https://s/submit/', 'year' => '2026', 'entry_url' => function ( $x ) { return 'https://s/events/' . $x['slug'] . '/'; } )
		);
		assert_true( false !== strpos( $html, '<title>The Fort Weekly — week of Oct 26</title>' ), 'title' );
		assert_true( false !== strpos( $html, 'Ruck &lt;script&gt;' ) && false === strpos( $html, '<script>' ), 'escaped title' );
		assert_true( false !== strpos( $html, 'href="https://s/events/ruck/"' ), 'entry link' );
		assert_true( false !== strpos( $html, 'A &amp; B' ), 'escaped summary' );
		assert_true( false !== strpos( $html, 'This week' ) && false !== strpos( $html, 'Oct 26 – Nov 1' ), 'this week section' );
	}
);

fortw_test(
	'the region’s week: one labelled row each, the FNG bar to scale, names escaped',
	function () {
		$html = fortw_nl_ledger(
			array(
				'fng_stats'    => array( 'total' => 82, 'goal' => 226, 'days_elapsed' => 295 ),
				'shovel_flags' => array( array( 'from' => 'Boogie <b>', 'to' => 'Bam Bam', 'ao' => 'The Armory' ) ),
				'vqs'          => array( array( 'name' => 'A', 'ao' => '' ), array( 'name' => 'B', 'ao' => 'Hive' ) ),
				'weekly_fngs'  => array( 'Teflon', '' ),
			)
		);
		assert_true( false !== strpos( $html, '<b class="amber">82</b> of 226 · day 295 of 365' ), 'FNG line' );
		assert_true( false !== strpos( $html, 'class="bar-fill" width="36%"' ), 'bar to scale' );
		assert_true( false !== strpos( $html, 'Boogie &lt;b&gt; → Bam Bam' ), 'escaped' );
		assert_true( false !== strpos( $html, '>VQs</td>' ) && false !== strpos( $html, 'A<br>B' ), 'VQs in one row' );
		assert_same( 4, substr_count( $html, 'class="lg-label' ) );
		assert_same( 1, substr_count( $html, 'lg-last' ) / 2 );
		$full = fortw_nl_ledger( array( 'fng_stats' => array( 'total' => 300, 'goal' => 226, 'days_elapsed' => 1 ) ) );
		assert_true( false !== strpos( $full, 'width="100%" height="6"' ) && false === strpos( $full, 'bar-rest' ), 'a full bar is one cell' );
		assert_same( '', fortw_nl_ledger( array() ) );
	}
);

fortw_test(
	'campaign: the coming Sunday, named and subjected like the app did',
	function () {
		assert_same( '2026-10-25', fortw_next_sunday( '2026-10-20' ) );
		assert_same( '2026-10-25', fortw_next_sunday( '2026-10-25' ) );
		assert_same( '2026-11-01', fortw_next_sunday( '2026-10-26' ) );
		assert_same( 'October 25, 2026', fortw_campaign_title( '2026-10-25' ) );
		assert_same( 'F3 The Fort Weekly Newsletter - 10/25/2026', fortw_campaign_subject( '2026-10-25' ) );
	}
);
