<?php
/**
 * Mailchimp: creates or updates the week's campaign as a DRAFT. Nothing here sends, schedules or
 * test-sends anything; that is done by a person in Mailchimp. As a guard, the request helper
 * refuses every /actions/ endpoint (send, schedule, unschedule, test, replicate…), so no code
 * path can reach them.
 *
 *   define( 'FORT_MAILCHIMP_API_KEY', '…-us10' );
 *   define( 'FORT_MAILCHIMP_LIST_ID', '…' );                    // the audience
 *   define( 'FORT_MAILCHIMP_FROM_NAME', 'The Fort Weekly' );    // optional
 *   define( 'FORT_MAILCHIMP_FROM_EMAIL', 'newsletter@thefort.org' ); // optional
 *
 * Campaigns are named like the newsletter app named them ("October 25, 2026" for the coming
 * Sunday), so an existing draft from either is found and updated rather than duplicated.
 *
 * @package FortWeekly
 */

defined( 'ABSPATH' ) || exit;

function fortw_mailchimp_configured() {
	return defined( 'FORT_MAILCHIMP_API_KEY' ) && FORT_MAILCHIMP_API_KEY && defined( 'FORT_MAILCHIMP_LIST_ID' ) && FORT_MAILCHIMP_LIST_ID;
}

function fortw_mc_from() {
	return array(
		'name'  => defined( 'FORT_MAILCHIMP_FROM_NAME' ) ? FORT_MAILCHIMP_FROM_NAME : 'The Fort Weekly',
		'email' => defined( 'FORT_MAILCHIMP_FROM_EMAIL' ) ? FORT_MAILCHIMP_FROM_EMAIL : 'newsletter@thefort.org',
	);
}

/** One Mailchimp API call. Returns the decoded body, or WP_Error. Never touches /actions/. */
function fortw_mc_request( $method, $path, $body = null ) {
	if ( ! fortw_mailchimp_configured() ) {
		return new WP_Error( 'fortw_mc', __( 'Mailchimp is not set up.', 'fort-weekly' ) );
	}
	if ( false !== strpos( $path, '/actions/' ) || ! in_array( $method, array( 'GET', 'POST', 'PATCH', 'PUT', 'DELETE' ), true ) ) {
		return new WP_Error( 'fortw_mc_refused', 'Refused: Fort Weekly only creates and edits drafts.' );
	}
	$dc       = substr( strrchr( FORT_MAILCHIMP_API_KEY, '-' ), 1 );
	$response = wp_remote_request(
		'https://' . ( $dc ? $dc : 'us10' ) . '.api.mailchimp.com/3.0' . $path,
		array(
			'method'  => $method,
			'timeout' => 20,
			'headers' => array(
				'Authorization' => 'Basic ' . base64_encode( 'fortweekly:' . FORT_MAILCHIMP_API_KEY ), // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode
				'Content-Type'  => 'application/json',
			),
			'body'    => null === $body ? null : wp_json_encode( $body ),
		)
	);
	if ( is_wp_error( $response ) ) {
		return $response;
	}
	$code = (int) wp_remote_retrieve_response_code( $response );
	$data = json_decode( wp_remote_retrieve_body( $response ), true );
	if ( $code >= 300 ) {
		$detail = is_array( $data ) ? ( $data['detail'] ?? '' ) . ( ! empty( $data['errors'] ) ? ' ' . implode( '; ', array_column( $data['errors'], 'message' ) ) : '' ) : '';
		return new WP_Error( 'fortw_mc', sprintf( 'Mailchimp said %d: %s', $code, trim( $detail ) ) );
	}
	return is_array( $data ) ? $data : array();
}

/**
 * Creates the coming Sunday's campaign as a draft with $html, or updates the draft if one with
 * that name already exists. Refuses (without touching it) if that campaign is already scheduled
 * or sent. Returns array( id, web_id, action: created|updated, title, subject ) or WP_Error.
 */
function fortw_mc_save_draft( $html, $today ) {
	$sunday  = fortw_next_sunday( $today );
	$title   = fortw_campaign_title( $sunday );
	$from    = fortw_mc_from();
	$settings = array(
		'subject_line' => fortw_campaign_subject( $sunday ),
		'preview_text' => 'Read your newsletter!',
		'title'        => $title,
		'from_name'    => $from['name'],
		'reply_to'     => $from['email'],
	);

	$list = fortw_mc_request(
		'GET',
		'/campaigns?' . http_build_query(
			array(
				'count'             => 200,
				'since_create_time' => gmdate( 'c', time() - 60 * DAY_IN_SECONDS ),
				'sort_field'        => 'create_time',
				'sort_dir'          => 'DESC',
				'fields'            => 'campaigns.id,campaigns.web_id,campaigns.status,campaigns.settings.title',
			)
		)
	);
	if ( is_wp_error( $list ) ) {
		return $list;
	}
	$existing = null;
	foreach ( (array) ( $list['campaigns'] ?? array() ) as $c ) {
		if ( ( $c['settings']['title'] ?? '' ) === $title ) {
			$existing = $c;
			break;
		}
	}

	if ( $existing ) {
		if ( 'save' !== $existing['status'] ) {
			/* translators: 1: campaign name, 2: its Mailchimp status */
			return new WP_Error( 'fortw_mc_locked', sprintf( __( 'The “%1$s” campaign is already %2$s in Mailchimp, so it was left alone. Change it in Mailchimp if needed.', 'fort-weekly' ), $title, $existing['status'] ) );
		}
		$updated = fortw_mc_request( 'PATCH', '/campaigns/' . rawurlencode( $existing['id'] ), array( 'settings' => $settings ) );
		if ( is_wp_error( $updated ) ) {
			return $updated;
		}
		$content = fortw_mc_request( 'PUT', '/campaigns/' . rawurlencode( $existing['id'] ) . '/content', array( 'html' => $html ) );
		if ( is_wp_error( $content ) ) {
			return $content;
		}
		return array( 'id' => $existing['id'], 'web_id' => $existing['web_id'] ?? 0, 'action' => 'updated', 'title' => $title, 'subject' => $settings['subject_line'] );
	}

	$made = fortw_mc_request(
		'POST',
		'/campaigns',
		array(
			'type'       => 'regular',
			'recipients' => array( 'list_id' => FORT_MAILCHIMP_LIST_ID ),
			'settings'   => $settings,
		)
	);
	if ( is_wp_error( $made ) ) {
		return $made;
	}
	$content = fortw_mc_request( 'PUT', '/campaigns/' . rawurlencode( $made['id'] ) . '/content', array( 'html' => $html ) );
	if ( is_wp_error( $content ) ) {
		fortw_mc_request( 'DELETE', '/campaigns/' . rawurlencode( $made['id'] ) ); // Remove the empty draft we just made.
		return $content;
	}
	return array( 'id' => $made['id'], 'web_id' => $made['web_id'] ?? 0, 'action' => 'created', 'title' => $title, 'subject' => $settings['subject_line'] );
}
