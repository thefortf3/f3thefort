<?php
/**
 * Text from an anonymous form, made safe for a Slack message. Slack's control sequences are
 * wrapped in <...> (<!channel>, <@U123>, <https://evil|Click me>), so escaping &, < and > as
 * Slack documents keeps a submitter from pinging the channel or disguising links; formatting
 * characters are stripped so a title can't restyle the message. Port of slackText() in the
 * newsletter app's lib/slack.js.
 *
 * @package FortWeekly
 */

defined( 'ABSPATH' ) || defined( 'FORTW_TESTING' ) || exit;

function fortw_slack_text( $s, $max = 200 ) {
	$s = str_replace( array( '*', '_', '~', '`' ), '', (string) $s );
	$s = str_replace( array( '&', '<', '>' ), array( '&amp;', '&lt;', '&gt;' ), $s );
	return mb_substr( trim( preg_replace( '/\s+/u', ' ', $s ) ), 0, $max );
}

/** The Slack message for a new pending event. $who: submitter name/email; $review_url: its edit screen. */
function fortw_slack_message( $entry, $who, $review_url ) {
	$dates = array();
	foreach ( array_slice( $entry['occurrences'], 0, 3 ) as $o ) {
		$p       = fortw_date_parts( $o['date'] );
		$dates[] = ucfirst( strtolower( $p['dow'] ) ) . ', ' . ucfirst( strtolower( $p['mon'] ) ) . ' ' . $p['day'] . ( $o['start_time'] ? ' ' . $o['start_time'] : '' );
	}
	$when  = $dates ? implode( ', ', $dates ) . ( count( $entry['occurrences'] ) > 3 ? ' +' . ( count( $entry['occurrences'] ) - 3 ) . ' more' : '' ) : 'No date (ongoing)';
	$title = fortw_slack_text( $entry['title'], 160 );
	$by    = fortw_slack_text( implode( ' · ', array_filter( array( $who['name'], $who['email'] ) ) ) );
	$lines = array_filter(
		array(
			'*' . $title . '*',
			$when,
			$entry['location'] ? '📍 ' . fortw_slack_text( $entry['location'] ) : '',
			$entry['leader'] ? 'Q: ' . fortw_slack_text( $entry['leader'], 80 ) : '',
			'Submitted by ' . ( '' !== $by ? $by : 'anonymous' ),
		)
	);
	return array(
		'text'   => 'New event needs approval: ' . $title,
		'blocks' => array(
			array( 'type' => 'section', 'text' => array( 'type' => 'mrkdwn', 'text' => ":inbox_tray: *New event waiting for approval*\n" . implode( "\n", $lines ) ) ),
			array( 'type' => 'actions', 'elements' => array( array( 'type' => 'button', 'text' => array( 'type' => 'plain_text', 'text' => 'Review' ), 'url' => $review_url ) ) ),
		),
	);
}
