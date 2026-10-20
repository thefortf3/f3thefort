<?php
// Submitter edit links, proposed changes and their emails.

fortw_test(
	'edit links: only "<id>-<token>" with a long token is accepted',
	function () {
		$token = str_repeat( 'aB3', 10 );
		assert_same( array( 123, $token ), fortw_parse_edit_param( '123-' . $token ) );
		assert_same( null, fortw_parse_edit_param( '123-short' ) );
		assert_same( null, fortw_parse_edit_param( 'abc-' . $token ) );
		assert_same( null, fortw_parse_edit_param( '123-' . $token . '<script>' ) );
		assert_same( null, fortw_parse_edit_param( array( '123' ) ) );
	}
);

fortw_test(
	'edit links stop working a month after the last date; undated events never',
	function () {
		$occ = array( array( 'date' => '2026-10-01', 'start_time' => null, 'end_time' => null ), array( 'date' => '2026-10-24', 'start_time' => null, 'end_time' => null ) );
		assert_true( ! fortw_edit_link_expired( $occ, '2026-11-23' ), 'still within 30 days of the last date' );
		assert_true( fortw_edit_link_expired( $occ, '2026-11-24' ), '31 days after' );
		assert_true( ! fortw_edit_link_expired( array(), '2030-01-01' ), 'ongoing' );
	}
);

fortw_test(
	'a proposed change lists only what differs, in order',
	function () {
		$live     = array( 'title' => 'Ruck', 'when' => 'Sat Oct 24 0915', 'where' => 'NaFo', 'q' => 'Iron Man', 'text' => 'Old  text', 'link' => '', 'flyer' => 'a.png', 'name' => 'X', 'email' => 'x@y.z', 'phone' => '' );
		$proposed = array_merge( $live, array( 'title' => 'Ruck and Roll', 'text' => "Old\ntext", 'flyer' => 'b.png', 'link' => 'https://e.org' ) );
		assert_same(
			array(
				array( 'Event name', 'Ruck', 'Ruck and Roll' ),
				array( 'Sign-up link', '', 'https://e.org' ),
				array( 'Flyer', 'a.png', 'b.png' ),
			),
			fortw_change_rows( $live, $proposed ),
			'whitespace-only edits are not changes'
		);
		assert_same( array(), fortw_change_rows( $live, $live ) );
	}
);

fortw_test(
	'dates summary for comparisons',
	function () {
		assert_same( 'Ongoing', fortw_when_text( array() ) );
		assert_same(
			'Sat Oct 24 0700–0800, Sat Oct 31',
			fortw_when_text( array( array( 'date' => '2026-10-24', 'start_time' => '0700', 'end_time' => '0800' ), array( 'date' => '2026-10-31', 'start_time' => null, 'end_time' => null ) ) )
		);
	}
);

fortw_test(
	'submitter emails: live and changes, with the event and edit links',
	function () {
		list( $subject, $body ) = fortw_submitter_email( 'live', 'Ruck and Roll', 'Slash', 'https://s/events/ruck/', 'https://s/submit/?edit=1-x', 'F3 The Fort' );
		assert_same( 'Your event is live: Ruck and Roll', $subject );
		assert_true( 0 === strpos( $body, 'Thanks, Slash! "Ruck and Roll" has been approved.' ), $body );
		assert_true( false !== strpos( $body, 'See it: https://s/events/ruck/' ) && false !== strpos( $body, "\nhttps://s/submit/?edit=1-x\n" ) );
		list( $subject2, $body2 ) = fortw_submitter_email( 'changes', 'Ruck', '', 'u', 'e', 'F3 The Fort' );
		assert_same( 'Your changes are live: Ruck', $subject2 );
		assert_true( 0 === strpos( $body2, 'Thanks! Your changes to "Ruck"' ), $body2 );
	}
);
