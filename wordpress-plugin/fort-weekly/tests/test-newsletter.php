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
	'featured: the day, date and time large in the card; in the date list just its time and title',
	function () {
		$e    = fortw_t_entry( array( 'title' => 'Beers for Beetus', 'slug' => 'beers', 'featured' => true, 'description' => '<p>Only in the card.</p>', 'location' => 'Print Shop', 'occurrences' => array( array( 'date' => '2026-10-31', 'start_time' => '1100', 'end_time' => '1500' ) ) ) );
		$html = fortw_render_agenda(
			'{{BODY}}',
			array( $e ),
			array( 'three_fs' => array(), 'links' => array(), 'slt' => array() ),
			FORTW_T_TODAY,
			array( 'site_url' => 'https://s', 'submit_url' => 'https://s/submit/', 'year' => '2026', 'entry_url' => function ( $x ) { return 'https://s/events/' . $x['slug'] . '/'; } )
		);
		assert_true( false !== strpos( $html, '<div class="fdate">Saturday, Oct 31 · 1100–1500</div>' ), 'large date in the card' );
		assert_same( 1, substr_count( $html, 'Only in the card.' ), 'the write-up only once' );
		assert_true( (bool) preg_match( '/class="day".*1100–1500<span class="new">Featured<\/span><\/div>\s*<a class="title" href="https:\/\/s\/events\/beers\/">Beers for Beetus<\/a><\/div>/s', $html ), 'short line in the day' );
	}
);

fortw_test(
	'every week: each F in a column, one event a line, its calendar under it; a links-only F joins the pills; the SLT as a table',
	function () {
		$region = array(
			'three_fs' => array(
				array( 'column' => 'fitness', 'items' => array( array( 'type' => 'link', 'label' => 'Workout List', 'url' => 'https://x/w' ) ) ),
				array( 'column' => 'fellowship', 'items' => array( array( 'type' => 'event', 'name' => 'Pizza <&>', 'detail' => '1800 · Emilio’s' ), array( 'type' => 'link', 'label' => 'Fellowship Calendar', 'url' => 'https://x/c' ) ) ),
				array( 'column' => 'faith', 'items' => array( array( 'type' => 'event', 'name' => 'McGospel', 'detail' => '' ) ) ),
			),
			'links'    => array( array( 'label' => 'Slack', 'url' => 'https://x/s' ) ),
		);
		$html = fortw_nl_every_week( $region );
		assert_same( 2, substr_count( $html, 'class="ew-col"' ), 'a column per F with events' );
		assert_true( false !== strpos( $html, 'width="50%"' ), 'split evenly' );
		assert_true( false !== strpos( $html, '2nd F · Fellowship</div><div class="ew-item"><span class="title title--sm">Pizza &lt;&amp;&gt;</span><div class="meta">1800 · Emilio’s</div></div><p class="small"><a class="lnk" href="https://x/c">Fellowship Calendar ↗</a></p>' ), 'events then the calendar' );
		assert_true( false !== strpos( $html, '<span class="title title--sm">McGospel</span></div>' ), 'no empty detail line' );
		assert_true( strpos( $html, '>Workout List ↗</a>' ) < strpos( $html, '>Slack ↗</a>' ) && false !== strpos( $html, 'class="pill" href="https://x/w"' ), 'links-only F first in the pills' );
		$foot = fortw_nl_footer( array( 'slt' => array( array( 'role' => 'Nan’tan', 'name' => 'Band Camp' ), array( 'role' => 'Comz', 'name' => '' ) ) ), array( 'submit_url' => 'https://x/submit', 'site_url' => 'https://x', 'year' => '2026' ) );
		assert_true( false !== strpos( $foot, '<div class="label">Your SLT</div><table role="presentation" class="ledger slt"' ) && false !== strpos( $foot, '>Nan’tan</td><td class="lg-value lg-last" valign="top">Band Camp</td>' ), 'SLT rows; empty names left out' );
	}
);

fortw_test(
	'places are links in the theme’s colour (so mail apps don’t make them blue): to the URL in them, else a Maps search',
	function () {
		assert_same(
			'<a class="place" href="https://maps.app.goo.gl/Y8SQ7Nnr1nftUVzs5">Print Shop</a>',
			fortw_nl_place( 'Print Shop: https://maps.app.goo.gl/Y8SQ7Nnr1nftUVzs5' )
		);
		assert_same( '<a class="place" href="https://maps.app.goo.gl/x">Map</a>', fortw_nl_place( 'https://maps.app.goo.gl/x' ) );
		assert_same(
			'<a class="place" href="https://www.google.com/maps/search/?api=1&amp;query=Casa%20de%20%3Cb%3EOrder%3C%2Fb%3E%2C%20Tega%20Cay">Casa de &lt;b&gt;Order&lt;/b&gt;, Tega Cay</a>',
			fortw_nl_place( 'Casa de <b>Order</b>, Tega Cay' )
		);
		assert_same( '', fortw_nl_place( '  ' ) );
		assert_same(
			'0530 · <a class="place" href="https://www.google.com/maps/search/?api=1&amp;query=The%20Hive">The Hive</a> · Q: Bam &amp; Bam',
			fortw_nl_meta_html( array( 'location' => 'The Hive', 'leader' => 'Bam & Bam' ), array( '0530' ) )
		);
		assert_same( 'Q: X', fortw_nl_meta_html( array( 'location' => '', 'leader' => 'X' ) ) );
	}
);

fortw_test(
	'the region’s week: one labelled row each, the FNG bar to scale, FNGs with who EH’d them, names escaped',
	function () {
		$html = fortw_nl_ledger(
			array(
				'fng_stats'    => array( 'total' => 82, 'goal' => 226, 'days_elapsed' => 295 ),
				'shovel_flags' => array( array( 'from' => 'Boogie <b>', 'to' => 'Bam Bam', 'ao' => 'The Armory' ) ),
				'vqs'          => array( array( 'name' => 'A', 'ao' => '' ), array( 'name' => 'B', 'ao' => 'Hive' ) ),
				'weekly_fngs'  => array( array( 'name' => 'Teflon', 'eh' => 'Band <i>Camp' ), array( 'name' => 'Fudd', 'eh' => '' ), array( 'name' => '', 'eh' => 'X' ) ),
			)
		);
		assert_true( false !== strpos( $html, '<b class="amber">82</b> of 226 · day 295 of 365' ), 'FNG line' );
		assert_true( false !== strpos( $html, 'class="bar-fill" width="36%"' ), 'bar to scale' );
		assert_true( false !== strpos( $html, 'Boogie &lt;b&gt; → Bam Bam' ), 'escaped' );
		assert_true( false !== strpos( $html, '>VQs</td>' ) && false !== strpos( $html, 'A<br>B' ), 'VQs in one row' );
		assert_true( false !== strpos( $html, '>FNGs this week</td>' ) && false !== strpos( $html, 'Teflon <span class="dim">EH’d by Band &lt;i&gt;Camp</span><br>Fudd</td>' ), 'FNGs one a line, with their EH' );
		assert_true( false !== strpos( fortw_nl_ledger( array( 'weekly_fngs' => array( array( 'name' => 'Solo', 'eh' => 'Q' ) ) ) ), '>FNG this week</td>' ), 'one FNG' );
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
