<?php
/**
 * Outside services, each switched on only by constants in wp-config.php (never stored in the
 * database): Groq for "write a summary for me". Slack and Mailchimp live alongside.
 *
 *   define( 'FORT_GROQ_API_KEY', '…' );
 *
 * @package FortWeekly
 */

defined( 'ABSPATH' ) || exit;

function fortw_groq_configured() {
	return defined( 'FORT_GROQ_API_KEY' ) && FORT_GROQ_API_KEY;
}

/** The newsletter app's teaser prompt, asking for plain text (the summary field isn't HTML). */
const FORTW_GROQ_SYSTEM = 'You are a newsletter editor. When given event information, write a short, punchy teaser suitable for a community newsletter — a couple sentences, not a summary of the whole event. Capture what the event is and why people should care enough to click through. Write in third person. Sound human, no flowery language — the goal is to drive excitement and encourage participation. A link to the full post with all the details (date, time, location, sign-up, etc.) will automatically be appended right after your teaser, so do not restate those details or try to be comprehensive — tease it, don\'t cover it. Do not add your own link or call-to-action referencing a link; the link is handled separately. Return one plain-text paragraph only: no HTML, no markdown, no preamble, and no surrounding quotation marks.';

/** A one-paragraph teaser for an event, or a WP_Error. */
function fortw_groq_summary( $title, $text ) {
	if ( ! fortw_groq_configured() ) {
		return new WP_Error( 'fortw_groq', __( 'Summary writing is not set up (FORT_GROQ_API_KEY).', 'fort-weekly' ) );
	}
	$response = wp_remote_post(
		'https://api.groq.com/openai/v1/chat/completions',
		array(
			'timeout' => 20,
			'headers' => array( 'Authorization' => 'Bearer ' . FORT_GROQ_API_KEY, 'Content-Type' => 'application/json' ),
			'body'    => wp_json_encode(
				array(
					'model'       => 'llama-3.1-8b-instant',
					'temperature' => 0.4,
					'messages'    => array(
						array( 'role' => 'system', 'content' => FORTW_GROQ_SYSTEM ),
						array( 'role' => 'user', 'content' => "Write a newsletter snippet for the following event.\n\n" . $title . "\n\n" . $text ),
					),
				)
			),
		)
	);
	if ( is_wp_error( $response ) || 200 !== (int) wp_remote_retrieve_response_code( $response ) ) {
		error_log( 'Fort Weekly: Groq summary failed: ' . ( is_wp_error( $response ) ? $response->get_error_message() : wp_remote_retrieve_response_code( $response ) ) );
		return new WP_Error( 'fortw_groq', __( 'Could not write a summary just now. Try again, or write one.', 'fort-weekly' ) );
	}
	$data = json_decode( wp_remote_retrieve_body( $response ), true );
	$out  = (string) ( $data['choices'][0]['message']['content'] ?? '' );
	$out  = preg_replace( '/^```\w*\s*|\s*```$/', '', trim( $out ) );
	$out  = trim( wp_strip_all_tags( $out ), " \t\n\r\"'" );
	$out  = trim( preg_replace( '/[\[(][^\])]*\blink\b[^\])]*[\])]/i', '', $out ) ); // A made-up "[link]" placeholder.
	return mb_substr( $out, 0, 400 );
}
