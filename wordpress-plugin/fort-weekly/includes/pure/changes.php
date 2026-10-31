<?php
/**
 * Submitter edit links and proposed changes: parsing a link, when it stops working, what changed
 * between the live event and a proposed change, and the submitter emails' wording. Pure, so
 * they're unit-tested (tests/test-changes.php).
 *
 * @package FortWeekly
 */

defined( 'ABSPATH' ) || defined( 'FORTW_TESTING' ) || exit;

/** Days after an event's last date that its edit link keeps working. */
const FORTW_EDIT_LINK_GRACE_DAYS = 30;

/** "123-AbCd…" (the ?edit= value) → array( 123, 'AbCd…' ), or null if it isn't one. */
function fortw_parse_edit_param( $value ) {
	if ( ! is_string( $value ) || ! preg_match( '/^(\d{1,12})-([A-Za-z0-9]{24,64})$/', trim( $value ), $m ) ) {
		return null;
	}
	return array( (int) $m[1], $m[2] );
}

/** True once the link has stopped working: a month after the last date (undated events: never). */
function fortw_edit_link_expired( $occurrences, $today ) {
	if ( ! $occurrences ) {
		return false;
	}
	$last = end( $occurrences );
	return fortw_add_days( $last['date'], FORTW_EDIT_LINK_GRACE_DAYS ) < $today;
}

/**
 * What a proposed change alters, as rows of array( label, before, after ) in display order.
 * $live / $proposed: arrays with title, text (description as plain text), when, where, q, link,
 * flyer (URL or ''), and the submitter's name, email, phone.
 */
function fortw_change_rows( $live, $proposed ) {
	$labels = array(
		'title' => 'Event name',
		'when'  => 'When',
		'where' => 'Where',
		'q'     => 'Q',
		'text'  => 'Description',
		'link'  => 'Sign-up link',
		'flyer' => 'Flyer',
		'name'  => 'Submitter name',
		'email' => 'Submitter email',
		'phone' => 'Submitter phone',
	);
	$rows = array();
	foreach ( $labels as $key => $label ) {
		$a = trim( preg_replace( '/\s+/u', ' ', (string) ( $live[ $key ] ?? '' ) ) );
		$b = trim( preg_replace( '/\s+/u', ' ', (string) ( $proposed[ $key ] ?? '' ) ) );
		if ( $a !== $b ) {
			$rows[] = array( $label, $a, $b );
		}
	}
	return $rows;
}

/** "Sat Oct 24 0700–0800" style summary of an event's dates (one running several days: "Sat Oct 17 – Sat Oct 24"), for comparing and emails. */
function fortw_when_text( $occurrences ) {
	if ( ! $occurrences ) {
		return 'Ongoing';
	}
	return implode(
		', ',
		array_map(
			function ( $o ) {
				$p = fortw_date_parts( $o['date'] );
				$t = $o['start_time'] ? ' ' . $o['start_time'] . ( $o['end_time'] ? '–' . $o['end_time'] : '' ) : '';
				$u = '';
				if ( ! empty( $o['end_date'] ) ) {
					$q = fortw_date_parts( $o['end_date'] );
					$u = ' – ' . ucfirst( strtolower( $q['dow'] ) ) . ' ' . ucfirst( strtolower( $q['mon'] ) ) . ' ' . $q['day'];
				}
				return ucfirst( strtolower( $p['dow'] ) ) . ' ' . ucfirst( strtolower( $p['mon'] ) ) . ' ' . $p['day'] . $u . $t;
			},
			$occurrences
		)
	);
}

/**
 * The submitter emails: 'received' (just submitted), 'live' (the event was approved) or 'changes'
 * (their edit was approved). Returns array( subject, body ) as plain text.
 */
function fortw_submitter_email( $kind, $title, $name, $event_url, $edit_url, $site_name ) {
	$hi = '' !== trim( (string) $name ) ? 'Thanks, ' . trim( $name ) . '!' : 'Thanks!';
	if ( 'received' === $kind ) {
		// Not on the site yet, so no link to it: just the edit link, to fix anything before it's approved.
		return array(
			'We got your event: ' . $title,
			$hi . ' We have "' . $title . '". An editor will look at it soon, and we will email you again when it is on the site.' . "\n\n"
			. "Spotted a mistake, or need to change something? Use your private edit link:\n"
			. $edit_url . "\n\n"
			. "Keep this link to yourself: anyone with it can change your event.\n\n"
			. '— ' . $site_name . "\n",
		);
	}
	if ( 'changes' === $kind ) {
		$subject = 'Your changes are live: ' . $title;
		$lead    = $hi . ' Your changes to "' . $title . '" have been approved and are on the site now.';
	} else {
		$subject = 'Your event is live: ' . $title;
		$lead    = $hi . ' "' . $title . '" has been approved. It is on the site now and will be in the next issue of The Fort Weekly.';
	}
	$body = $lead . "\n\n"
		. 'See it: ' . $event_url . "\n\n"
		. "Need to change something? Use your private edit link. Changes are checked by an editor before they go live, and your event stays as it is until then:\n"
		. $edit_url . "\n\n"
		. "Keep this link to yourself: anyone with it can suggest changes.\n\n"
		. '— ' . $site_name . "\n";
	return array( $subject, $body );
}
