<?php
/**
 * Submitters editing their own events, and the emails they get.
 *
 * Every submitted event has a private edit link (/submit/?edit=<id>-<token>), shown on the
 * thank-you page and in the "your event is live" email. Anyone holding it can propose changes,
 * which an editor approves first:
 *   - an event not approved yet is simply updated (nothing is public);
 *   - a live event gets a separate pending "change" post (_fort_change_of = the live event), so
 *     the site and newsletter keep the current version. Approving the change copies it onto the
 *     live event and removes the change; rejecting it keeps it in Rejected as a record. A newer
 *     edit replaces a change still waiting.
 *
 * Emails go to the submitter's address when the event is approved and when a change is. They are
 * only logged unless FORT_SUBMITTER_EMAILS is true in wp-config.php (FORT_EMAIL_FROM optionally
 * sets the sender), so test sites never send anything.
 *
 * @package FortWeekly
 */

defined( 'ABSPATH' ) || exit;

// ── Edit links ──────────────────────────────────────────────────────────

/** The event's edit-link token, created on first use. Kept in private meta (editors only). */
function fortw_edit_token( $post_id, $create = true ) {
	$token = (string) get_post_meta( $post_id, '_fort_edit_token', true );
	if ( '' === $token && $create ) {
		$token = wp_generate_password( 32, false, false );
		update_post_meta( $post_id, '_fort_edit_token', $token );
	}
	return $token;
}

/** A new token: the old link stops working. */
function fortw_reset_edit_token( $post_id ) {
	delete_post_meta( $post_id, '_fort_edit_token' );
	return fortw_edit_token( $post_id );
}

function fortw_edit_param( $post_id ) {
	return (int) $post_id . '-' . fortw_edit_token( $post_id );
}

function fortw_edit_url( $post_id ) {
	return add_query_arg( 'edit', fortw_edit_param( $post_id ), home_url( '/submit/' ) );
}

/**
 * The live (or still pending) event an ?edit= value opens, or WP_Error: the link is malformed,
 * wrong, for a rejected/archived event, or past its date.
 */
function fortw_edit_target( $param ) {
	$parsed = fortw_parse_edit_param( $param );
	$post   = $parsed ? get_post( $parsed[0] ) : null;
	if ( ! $post || FORTW_POST_TYPE !== $post->post_type || get_post_meta( $post->ID, '_fort_change_of', true ) ) {
		return new WP_Error( 'fortw_link', 'invalid' );
	}
	$token = (string) get_post_meta( $post->ID, '_fort_edit_token', true );
	if ( '' === $token || ! hash_equals( $token, $parsed[1] ) ) {
		return new WP_Error( 'fortw_link', 'invalid' );
	}
	if ( ! in_array( $post->post_status, array( 'publish', 'pending', 'draft' ), true ) || fortw_edit_link_expired( fortw_get_occurrences( $post->ID ), fortw_today() ) ) {
		return new WP_Error( 'fortw_link', 'closed' );
	}
	return $post;
}

/** The change waiting for approval on a live event, or 0. */
function fortw_pending_change( $post_id ) {
	$ids = get_posts(
		array(
			'post_type'        => FORTW_POST_TYPE,
			'post_status'      => 'pending',
			'posts_per_page'   => 1,
			'fields'           => 'ids',
			'suppress_filters' => true,
			'meta_key'         => '_fort_change_of',
			'meta_value'       => (int) $post_id,
		)
	);
	return $ids ? (int) $ids[0] : 0;
}

/** True for a proposed-change post (not a real event). */
function fortw_is_change( $post_id ) {
	return (bool) get_post_meta( $post_id, '_fort_change_of', true );
}

// ── Saving a submitter's edit ───────────────────────────────────────────

/** The fields a submitter can edit, copied between an event and its proposed change. */
function fortw_submitter_meta_keys() {
	return array( '_fort_leader', '_fort_location', '_fort_link', '_fort_submitter_name', '_fort_submitter_email', '_fort_submitter_phone' );
}

/**
 * Writes submitted fields onto $post_id. $f: title, content, meta (key => value), occurrences (or
 * null to leave dates alone), flyer: 'keep' | 'remove' | attachment id.
 */
function fortw_write_submitted_fields( $post_id, $f ) {
	wp_update_post( wp_slash( array( 'ID' => $post_id, 'post_title' => $f['title'], 'post_content' => $f['content'] ) ) );
	foreach ( $f['meta'] as $key => $value ) {
		if ( '' === (string) $value ) {
			delete_post_meta( $post_id, $key );
		} else {
			update_post_meta( $post_id, $key, $value );
		}
	}
	if ( null !== $f['occurrences'] ) {
		fortw_set_occurrences( $post_id, $f['occurrences'] );
	}
	if ( 'remove' === $f['flyer'] ) {
		delete_post_thumbnail( $post_id );
	} elseif ( is_int( $f['flyer'] ) && $f['flyer'] > 0 ) {
		set_post_thumbnail( $post_id, $f['flyer'] );
	}
}

/**
 * Applies a submitter's edit to $event. Not approved yet: updated in place. Live: saved as (or
 * into) its pending change. Returns the post the edit went to.
 */
function fortw_save_submitter_edit( $event, $f ) {
	if ( 'publish' !== $event->post_status ) {
		fortw_write_submitted_fields( $event->ID, $f );
		return $event->ID;
	}
	$change = fortw_pending_change( $event->ID );
	if ( ! $change ) {
		$change = wp_insert_post(
			array(
				'post_type'   => FORTW_POST_TYPE,
				'post_status' => 'pending',
				'post_title'  => $f['title'],
				'post_parent' => $event->ID,
				'post_author' => 0,
			)
		);
		update_post_meta( $change, '_fort_change_of', $event->ID );
		update_post_meta( $change, '_fort_origin', 'edit' );
	}
	// A change is the whole proposed version: start from the live event, then the edit.
	fortw_set_occurrences( $change, fortw_get_occurrences( $event->ID ) );
	$thumb = get_post_thumbnail_id( $event->ID );
	if ( $thumb ) {
		set_post_thumbnail( $change, $thumb );
	} else {
		delete_post_thumbnail( $change );
	}
	fortw_write_submitted_fields( $change, $f );
	return $change;
}

// ── Approving or rejecting a change ─────────────────────────────────────

/** Copies a proposed change onto its live event and removes the change. Returns the event id. */
function fortw_apply_change( $change_id ) {
	$event_id = (int) get_post_meta( $change_id, '_fort_change_of', true );
	$event    = get_post( $event_id );
	$change   = get_post( $change_id );
	if ( ! $event || ! $change ) {
		return new WP_Error( 'fortw_change', __( 'The event this change belongs to no longer exists.', 'fort-weekly' ) );
	}
	$meta = array();
	foreach ( fortw_submitter_meta_keys() as $key ) {
		$meta[ $key ] = (string) get_post_meta( $change_id, $key, true );
	}
	$thumb = (int) get_post_thumbnail_id( $change_id );
	fortw_write_submitted_fields(
		$event_id,
		array(
			'title'       => $change->post_title,
			'content'     => $change->post_content,
			'meta'        => $meta,
			'occurrences' => fortw_get_occurrences( $change_id ),
			'flyer'       => $thumb ? $thumb : 'remove',
		)
	);
	if ( $thumb ) {
		wp_update_post( array( 'ID' => $thumb, 'post_parent' => $event_id ) ); // The image belongs to the event now (never deleted).
	}
	wp_delete_post( $change_id, true ); // Only the change post; attached images stay.
	fortw_clear_page_cache();
	do_action( 'fortw_change_approved', $event_id );
	return $event_id;
}

// Publishing a change (the edit screen's button, or any status change to publish) applies it
// instead of making it a second event.
add_filter(
	'wp_insert_post_data',
	function ( $data, $postarr ) {
		$id = (int) ( $postarr['ID'] ?? 0 );
		if ( $id && FORTW_POST_TYPE === $data['post_type'] && 'publish' === $data['post_status'] && fortw_is_change( $id ) ) {
			$data['post_status']                   = 'pending';
			$GLOBALS['fortw_apply_after_save'][ $id ] = true;
		}
		return $data;
	},
	10,
	2
);

add_action(
	'wp_after_insert_post',
	function ( $post_id ) {
		if ( empty( $GLOBALS['fortw_apply_after_save'][ $post_id ] ) ) {
			return;
		}
		unset( $GLOBALS['fortw_apply_after_save'][ $post_id ] );
		$event = fortw_apply_change( $post_id );
		if ( ! is_wp_error( $event ) ) {
			$GLOBALS['fortw_applied_change_to'] = $event;
		}
	},
	30
);

// After approving a change from its edit screen, land on the live event (the change is gone).
add_filter(
	'redirect_post_location',
	function ( $location ) {
		if ( ! empty( $GLOBALS['fortw_applied_change_to'] ) ) {
			return add_query_arg( 'fortw_change_applied', 1, get_edit_post_link( $GLOBALS['fortw_applied_change_to'], 'url' ) );
		}
		return $location;
	}
);

// ── Emails to the submitter ─────────────────────────────────────────────

function fortw_submitter_emails_on() {
	return defined( 'FORT_SUBMITTER_EMAILS' ) && true === FORT_SUBMITTER_EMAILS;
}

/** Sends (or, unless switched on, only logs) a plain-text email. */
function fortw_mail( $to, $subject, $body ) {
	if ( ! fortw_submitter_emails_on() ) {
		error_log( '[fort-weekly email dry-run] to ' . $to . ': ' . $subject );
		return false;
	}
	$headers = array( 'Content-Type: text/plain; charset=UTF-8' );
	if ( defined( 'FORT_EMAIL_FROM' ) && FORT_EMAIL_FROM ) {
		$headers[] = 'From: ' . FORT_EMAIL_FROM;
	}
	return wp_mail( $to, $subject, $body, $headers );
}

function fortw_email_submitter( $event_id, $kind ) {
	$to = sanitize_email( (string) get_post_meta( $event_id, '_fort_submitter_email', true ) );
	if ( ! $to || ! is_email( $to ) ) {
		return false;
	}
	list( $subject, $body ) = fortw_submitter_email(
		$kind,
		get_post_field( 'post_title', $event_id ),
		(string) get_post_meta( $event_id, '_fort_submitter_name', true ),
		get_permalink( $event_id ),
		fortw_edit_url( $event_id ),
		wp_specialchars_decode( get_bloginfo( 'name' ), ENT_QUOTES )
	);
	return fortw_mail( $to, $subject, $body );
}

// "Your event is live" once per event, for events that came in through the form. Marked as sent
// only once it has gone, so an event approved while emails were off (or failing) gets it next time.
add_action(
	'fortw_event_approved',
	function ( $post_id ) {
		if ( fortw_is_change( $post_id ) || 'form' !== get_post_meta( $post_id, '_fort_origin', true ) || get_post_meta( $post_id, '_fort_live_email_sent', true ) ) {
			return;
		}
		if ( fortw_email_submitter( $post_id, 'live' ) ) {
			update_post_meta( $post_id, '_fort_live_email_sent', current_time( 'mysql', true ) );
		}
	},
	20
);

add_action(
	'fortw_change_approved',
	function ( $event_id ) {
		fortw_email_submitter( $event_id, 'changes' );
	}
);

// ── For the theme's submit page ─────────────────────────────────────────

/**
 * What the /submit/ form needs to open in edit mode for an ?edit= value: array( error ) for a bad
 * or closed link, else the current values to fill in. If a change is already waiting, the form
 * shows that (the newest version the submitter sent); sending again replaces it.
 */
function fort_weekly_edit_form( $param ) {
	$event = fortw_edit_target( $param );
	if ( is_wp_error( $event ) ) {
		return array( 'error' => $event->get_error_message() );
	}
	$pending = 'publish' === $event->post_status ? fortw_pending_change( $event->ID ) : 0;
	$source  = $pending ? $pending : $event->ID;
	$src     = get_post( $source );
	$occ     = fortw_get_occurrences( $source );
	$meta    = function ( $key ) use ( $source ) {
		return (string) get_post_meta( $source, $key, true );
	};
	return array(
		'param'           => fortw_edit_param( $event->ID ),
		'is_live'         => 'publish' === $event->post_status,
		'change_waiting'  => (bool) $pending,
		'event_url'       => 'publish' === $event->post_status ? get_permalink( $event->ID ) : '',
		'title'           => $src->post_title,
		'description'     => $src->post_content,
		'dates_editable'  => count( $occ ) <= 1,
		'dates_text'      => fortw_when_text( $occ ),
		'date'            => $occ ? $occ[0]['date'] : '',
		'start_time'      => $occ ? (string) $occ[0]['start_time'] : '',
		'end_time'        => $occ ? (string) $occ[0]['end_time'] : '',
		'location'        => $meta( '_fort_location' ),
		'leader'          => $meta( '_fort_leader' ),
		'link'            => $meta( '_fort_link' ),
		'flyer_url'       => (string) fortw_hero_url( $source ),
		'submitter_name'  => $meta( '_fort_submitter_name' ),
		'submitter_email' => $meta( '_fort_submitter_email' ),
		'submitter_phone' => $meta( '_fort_submitter_phone' ),
	);
}

/** The full edit URL for a thank-you page's ?fort_link= value, or '' if it isn't a working link. */
function fort_weekly_edit_link( $param ) {
	$event = fortw_edit_target( $param );
	return is_wp_error( $event ) ? '' : fortw_edit_url( $event->ID );
}
