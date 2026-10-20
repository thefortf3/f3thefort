<?php
// Slack notice — same cases as the newsletter app's tests/entries.unit.js (Slack section).

fortw_test(
	'Slack: submitter text cannot ping the channel, inject links or restyle the message',
	function () {
		assert_same( '&lt;!channel&gt; hi', fortw_slack_text( '<!channel> hi' ) );
		assert_same( '&lt;https://evil|Click me&gt;', fortw_slack_text( '<https://evil|Click me>' ) );
		assert_same( 'bold italic', fortw_slack_text( "*bold*   _italic_\n" ) );
		assert_same( 10, mb_strlen( fortw_slack_text( str_repeat( 'é', 50 ), 10 ) ) );
	}
);

fortw_test(
	'Slack: message lists the title, dates, place, Q and submitter, with a review button',
	function () {
		$entry = array(
			'title'       => 'Ruck <!here>',
			'location'    => 'NaFo',
			'leader'      => 'Iron Man',
			'occurrences' => array(
				array( 'date' => '2026-10-24', 'start_time' => '0915', 'end_time' => null ),
				array( 'date' => '2026-10-31', 'start_time' => null, 'end_time' => null ),
				array( 'date' => '2026-11-07', 'start_time' => null, 'end_time' => null ),
				array( 'date' => '2026-11-14', 'start_time' => null, 'end_time' => null ),
			),
		);
		$m    = fortw_slack_message( $entry, array( 'name' => 'Slash', 'email' => 'x@example.com' ), 'https://f3thefort.com/wp-admin/post.php?post=5&action=edit' );
		$text = $m['blocks'][0]['text']['text'];
		assert_same( 'New event needs approval: Ruck &lt;!here&gt;', $m['text'] );
		assert_true( false !== strpos( $text, 'Sat, Oct 24 0915, Sat, Oct 31, Sat, Nov 7 +1 more' ), $text );
		assert_true( false !== strpos( $text, '📍 NaFo' ) && false !== strpos( $text, 'Q: Iron Man' ) && false !== strpos( $text, 'Submitted by Slash · x@example.com' ), $text );
		assert_same( 'https://f3thefort.com/wp-admin/post.php?post=5&action=edit', $m['blocks'][1]['elements'][0]['url'] );
		$anon = fortw_slack_message( array( 'title' => 'X', 'location' => null, 'leader' => null, 'occurrences' => array() ), array( 'name' => '', 'email' => '' ), 'u' );
		assert_true( false !== strpos( $anon['blocks'][0]['text']['text'], "No date (ongoing)\nSubmitted by anonymous" ) );
	}
);
