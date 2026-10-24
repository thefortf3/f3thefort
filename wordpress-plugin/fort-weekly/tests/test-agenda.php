<?php
// Agenda selection and public shapes — same cases as the newsletter app's
// tests/newsletter-agenda.unit.js and tests/public-api.unit.js.

const FORTW_T_TODAY = '2026-10-20'; // A Tuesday.

function fortw_t_entry( $over = array() ) {
	static $next_id = 1;
	$occ = array_map(
		function ( $o ) {
			return array_merge( array( 'start_time' => null, 'end_time' => null ), $o );
		},
		$over['occurrences'] ?? array()
	);
	$e = array_merge(
		array(
			'id' => $next_id++, 'title' => 'Untitled', 'slug' => 'untitled', 'status' => 'approved', 'archived' => false,
			'hold_from_newsletter' => false, 'featured' => false, 'approved_at' => '2026-09-01 12:00:00', 'tags' => array(),
			'summary' => '', 'description' => '<p>desc</p>', 'location' => null, 'leader' => null, 'link' => null,
			'video_url' => null, 'preblast_url' => null, 'hero_image' => null,
		),
		$over
	);
	$e['occurrences']     = $occ;
	$e['next_occurrence'] = fortw_next_occurrence( $occ, FORTW_T_TODAY );
	return $e;
}

function fortw_t_titles( $sel ) {
	$out = array();
	foreach ( $sel['this_week'] as $d ) {
		$out = array_merge( $out, array_column( $d['entries'], 'title' ) );
	}
	$out = array_merge( $out, array_column( $sel['coming_up'], 'title' ), array_column( $sel['ongoing'], 'title' ) );
	sort( $out );
	return $out;
}

fortw_test(
	'only approved, unarchived, unheld entries with a future (or no) date are included',
	function () {
		$sel = fortw_select_agenda(
			array(
				fortw_t_entry( array( 'title' => 'Approved', 'occurrences' => array( array( 'date' => '2026-10-22' ) ) ) ),
				fortw_t_entry( array( 'title' => 'Pending', 'status' => 'pending', 'occurrences' => array( array( 'date' => '2026-10-22' ) ) ) ),
				fortw_t_entry( array( 'title' => 'Rejected', 'status' => 'rejected', 'occurrences' => array( array( 'date' => '2026-10-22' ) ) ) ),
				fortw_t_entry( array( 'title' => 'Held', 'hold_from_newsletter' => true, 'occurrences' => array( array( 'date' => '2026-10-22' ) ) ) ),
				fortw_t_entry( array( 'title' => 'Archived', 'archived' => true, 'occurrences' => array( array( 'date' => '2026-10-22' ) ) ) ),
				fortw_t_entry( array( 'title' => 'Past', 'occurrences' => array( array( 'date' => '2026-10-01' ) ) ) ),
				fortw_t_entry( array( 'title' => 'Ongoing' ) ),
			),
			FORTW_T_TODAY
		);
		assert_same( array( 'Approved', 'Ongoing' ), fortw_t_titles( $sel ) );
	}
);

fortw_test(
	'this week = next 7 days grouped by date; everything later goes to Coming up',
	function () {
		$sel = fortw_select_agenda(
			array(
				fortw_t_entry( array( 'title' => 'Today', 'occurrences' => array( array( 'date' => '2026-10-20', 'start_time' => '0515' ) ) ) ),
				fortw_t_entry( array( 'title' => 'Sat late', 'occurrences' => array( array( 'date' => '2026-10-24', 'start_time' => '1100' ) ) ) ),
				fortw_t_entry( array( 'title' => 'Sat early', 'occurrences' => array( array( 'date' => '2026-10-24', 'start_time' => '0730' ) ) ) ),
				fortw_t_entry( array( 'title' => 'Day 6', 'occurrences' => array( array( 'date' => '2026-10-26' ) ) ) ),
				fortw_t_entry( array( 'title' => 'Day 7', 'occurrences' => array( array( 'date' => '2026-10-27' ) ) ) ),
				fortw_t_entry( array( 'title' => 'Way out', 'occurrences' => array( array( 'date' => '2027-03-01' ) ) ) ),
			),
			FORTW_T_TODAY
		);
		assert_same( array( '2026-10-20', '2026-10-24', '2026-10-26' ), array_column( $sel['this_week'], 'date' ) );
		assert_same( array( 'Sat early', 'Sat late' ), array_column( $sel['this_week'][1]['entries'], 'title' ) );
		assert_same( array( 'Day 7', 'Way out' ), array_column( $sel['coming_up'], 'title' ) );
		assert_same( array( 'from' => '2026-10-20', 'to' => '2026-10-26' ), $sel['range'] );
	}
);

fortw_test(
	'an entry appears once, at its next date, listing later dates as "also"',
	function () {
		$sel = fortw_select_agenda( array( fortw_t_entry( array( 'title' => 'Bethel', 'occurrences' => array( array( 'date' => '2026-10-01' ), array( 'date' => '2026-11-05' ), array( 'date' => '2026-12-03' ) ) ) ) ), FORTW_T_TODAY );
		assert_same( 1, count( $sel['coming_up'] ) );
		assert_same( '2026-11-05', $sel['coming_up'][0]['next_occurrence']['date'] );
		assert_same( array( '2026-12-03' ), $sel['coming_up'][0]['also'] );
	}
);

fortw_test(
	'the featured entry is in the Featured card and also in the agenda, marked as featured',
	function () {
		$sel = fortw_select_agenda(
			array(
				fortw_t_entry( array( 'title' => 'Accelerate', 'featured' => true ) ),
				fortw_t_entry( array( 'title' => 'Beers', 'featured' => true, 'occurrences' => array( array( 'date' => '2026-10-24' ) ) ) ),
				fortw_t_entry( array( 'title' => 'Other', 'occurrences' => array( array( 'date' => '2026-10-22' ) ) ) ),
			),
			FORTW_T_TODAY
		);
		assert_same( 'Accelerate', $sel['featured']['title'] );
		assert_same( array( 'Accelerate' ), array_column( $sel['ongoing'], 'title' ) );
		assert_true( $sel['ongoing'][0]['featured'], 'marked in the list' );
		assert_same( array( false, false ), array_column( array_merge( $sel['this_week'][0]['entries'], $sel['this_week'][1]['entries'] ), 'featured' ), 'only the one in the card counts as featured' );
		$held = fortw_select_agenda( array( fortw_t_entry( array( 'title' => 'Held feature', 'featured' => true, 'hold_from_newsletter' => true ) ) ), FORTW_T_TODAY );
		assert_same( null, $held['featured'], 'a held featured entry is not featured in the newsletter' );
	}
);

fortw_test(
	'NEW marks entries approved within the last week',
	function () {
		$sel = fortw_select_agenda(
			array(
				fortw_t_entry( array( 'title' => 'Fresh', 'approved_at' => '2026-10-18 09:00:00', 'occurrences' => array( array( 'date' => '2026-10-22' ) ) ) ),
				fortw_t_entry( array( 'title' => 'Old', 'approved_at' => '2026-10-01 09:00:00', 'occurrences' => array( array( 'date' => '2026-10-22' ) ) ) ),
			),
			FORTW_T_TODAY
		);
		assert_same( array( 'Fresh' => true, 'Old' => false ), array_column( $sel['this_week'][0]['entries'], 'is_new', 'title' ) );
	}
);

$fortw_t_strip_scripts = function ( $h ) {
	return preg_replace( '#<script[\s\S]*?</script>#i', '', (string) $h );
};

fortw_test(
	'home: only approved, unarchived, current entries; held entries still shown on the site',
	function () use ( $fortw_t_strip_scripts ) {
		$entries = array(
			fortw_t_entry( array( 'title' => 'Approved soon', 'occurrences' => array( array( 'date' => '2026-10-22' ) ) ) ),
			fortw_t_entry( array( 'title' => 'Held from email', 'hold_from_newsletter' => true, 'occurrences' => array( array( 'date' => '2026-11-02' ) ) ) ),
			fortw_t_entry( array( 'title' => 'Pending one', 'status' => 'pending', 'occurrences' => array( array( 'date' => '2026-10-23' ) ) ) ),
			fortw_t_entry( array( 'title' => 'Archived one', 'archived' => true, 'occurrences' => array( array( 'date' => '2026-10-23' ) ) ) ),
			fortw_t_entry( array( 'title' => 'Past one', 'occurrences' => array( array( 'date' => '2026-09-01' ) ) ) ),
		);
		$home = fortw_build_home( $entries, array(), array(), FORTW_T_TODAY, $fortw_t_strip_scripts, 'now' );
		assert_same( array( 'Approved soon', 'Held from email' ), fortw_t_titles( $home ) );
	}
);

fortw_test(
	'public entries carry exactly the public fields, with sanitized HTML and only http(s) links',
	function () use ( $fortw_t_strip_scripts ) {
		$e = fortw_t_entry(
			array(
				'description' => '<p>Hi</p><script>x()</script>', 'link' => 'javascript:alert(1)', 'video_url' => 'ftp://v',
				'preblast_url' => 'https://f3thefort.com/pre', 'submitter_email' => 'pax@example.com', 'occurrences' => array( array( 'date' => '2026-10-22' ) ),
			)
		);
		$p = fortw_public_entry( $e, FORTW_T_TODAY, $fortw_t_strip_scripts );
		$keys = array_keys( $p );
		sort( $keys );
		assert_same( array( 'description_html', 'featured', 'hero_image', 'id', 'is_past', 'leader', 'link', 'location', 'next_occurrence', 'occurrences', 'preblast_url', 'slug', 'summary', 'tags', 'title', 'upcoming_dates', 'video_url' ), $keys );
		assert_true( false === strpos( json_encode( $p ), 'example.com' ), 'no submitter details' );
		assert_same( '<p>Hi</p>', $p['description_html'] );
		assert_same( null, $p['link'] );
		assert_same( null, $p['video_url'] );
		assert_same( 'https://f3thefort.com/pre', $p['preblast_url'] );
	}
);

fortw_test(
	'entry page: same-day entries first, then ones sharing a tag; never itself',
	function () use ( $fortw_t_strip_scripts ) {
		$i2   = array( 'id' => 9, 'label' => 'I2', 'slug' => 'i2', 'color' => '#8fb4d8' );
		$me   = fortw_t_entry( array( 'title' => 'Me', 'tags' => array( $i2 ), 'occurrences' => array( array( 'date' => '2026-10-24' ) ) ) );
		$day  = fortw_t_entry( array( 'title' => 'Same day', 'occurrences' => array( array( 'date' => '2026-10-24' ) ) ) );
		$tag  = fortw_t_entry( array( 'title' => 'Same tag', 'tags' => array( $i2 ), 'occurrences' => array( array( 'date' => '2026-11-24' ) ) ) );
		$none = fortw_t_entry( array( 'title' => 'Unrelated', 'occurrences' => array( array( 'date' => '2026-11-24' ) ) ) );
		$page = fortw_build_entry_page( $me, array( $me, $day, $tag, $none ), FORTW_T_TODAY, $fortw_t_strip_scripts );
		assert_same( 'Me', $page['entry']['title'] );
		assert_same( array( 'Same day' ), array_column( $page['same_day'], 'title' ) );
		assert_same( array( 'Same tag' ), array_column( $page['related'], 'title' ) );
	}
);

fortw_test(
	'entry page: a description image that is the flyer again is dropped, with the blank lines it leaves',
	function () {
		$flyer = function ( $src ) { return 'https://x/flyer.jpg' === $src; };
		assert_same(
			"It's the third annual Reindeer Run.",
			fortw_drop_images( '<div><img src="https://x/flyer.jpg"></div><div><br></div>It\'s the third annual Reindeer Run.', $flyer )
		);
		assert_same(
			'<p>Before</p><p>After <img src="https://x/map.png"></p>',
			fortw_drop_images( '<p>Before</p><p><a href="https://x/flyer.jpg"><img alt="" src="https://x/flyer.jpg" /></a></p><p>After <img src="https://x/map.png"></p>', $flyer )
		);
		$same = '<div>No flyer here</div><div><br></div><div>Second line</div>';
		assert_same( $same, fortw_drop_images( $same, $flyer ), 'untouched when nothing matches' );
	}
);

fortw_test(
	'FNG numbers: year-to-date vs goal, and this week (Mon–Sun) names',
	function () {
		$fng = array(
			'ytd'    => 82,
			'recent' => array(
				array( 'date' => '2026-10-19', 'f3_name' => 'Teflon', 'eh' => 'Band Camp' ), // Monday this week.
				array( 'date' => '2026-10-25', 'f3_name' => 'Sunday guy' ), // Sunday this week.
				array( 'date' => '2026-10-18', 'f3_name' => 'Last week' ),
			),
		);
		$out = fortw_fng_stats( $fng, 226, FORTW_T_TODAY );
		assert_same( array( 'total' => 82, 'goal' => 226, 'days_elapsed' => 293, 'year' => 2026 ), $out['stats'] );
		assert_same( array( array( 'name' => 'Teflon', 'eh' => 'Band Camp' ), array( 'name' => 'Sunday guy', 'eh' => '' ) ), $out['weekly'] );
		assert_same( array( 'stats' => null, 'weekly' => array() ), fortw_fng_stats( null, 226, FORTW_T_TODAY ) );
	}
);

fortw_test(
	'the newsletter’s week: Monday–Sunday after the Sunday it goes out',
	function () {
		assert_same( array( 'from' => '2026-10-26', 'to' => '2026-11-01' ), fortw_issue_week( '2026-10-20' ), 'built on a Tuesday' );
		assert_same( array( 'from' => '2026-10-26', 'to' => '2026-11-01' ), fortw_issue_week( '2026-10-25' ), 'built on the Sunday it goes out' );
		assert_same( array( 'from' => '2026-11-02', 'to' => '2026-11-08' ), fortw_issue_week( '2026-10-26' ), 'built on a Monday' );
		$sel = fortw_select_issue(
			array(
				fortw_t_entry( array( 'title' => 'Before the issue', 'occurrences' => array( array( 'date' => '2026-10-24' ) ) ) ),
				fortw_t_entry( array( 'title' => 'Twice', 'occurrences' => array( array( 'date' => '2026-10-22' ), array( 'date' => '2026-10-28' ) ) ) ),
				fortw_t_entry( array( 'title' => 'Sunday', 'occurrences' => array( array( 'date' => '2026-11-01' ) ) ) ),
				fortw_t_entry( array( 'title' => 'Next Monday', 'approved_at' => '2026-10-19 09:00:00', 'occurrences' => array( array( 'date' => '2026-11-02' ) ) ) ),
			),
			FORTW_T_TODAY
		);
		assert_same( array( '2026-10-28', '2026-11-01' ), array_column( $sel['this_week'], 'date' ), 'only the issue’s week, at the first date in it' );
		assert_same( array( 'Next Monday' ), array_column( $sel['coming_up'], 'title' ) );
		assert_true( $sel['coming_up'][0]['is_new'], 'new is still counted from the build day' );
		assert_same( array( 'from' => '2026-10-26', 'to' => '2026-11-01' ), $sel['range'] );
		$home = fortw_select_agenda( array( fortw_t_entry( array( 'title' => 'Sat', 'occurrences' => array( array( 'date' => '2026-10-24' ) ) ) ) ), FORTW_T_TODAY );
		assert_same( array( '2026-10-24' ), array_column( $home['this_week'], 'date' ), 'the website keeps the next 7 days' );
	}
);
