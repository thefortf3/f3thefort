<?php
/**
 * The approval workflow: approve, reject, archive/restore, feature and hold, and what happens when
 * an event is approved (approval time, optional pre-blast post, page cache).
 *
 * Approval is a WordPress status change (pending → publish), so it works the same from the
 * events list, the edit screen's Publish button, or anywhere else; the side effects hang off
 * transition_post_status.
 *
 * @package FortWeekly
 */

defined( 'ABSPATH' ) || exit;

/** Clears cached pages so changes show on the site right away (production runs WP Super Cache). */
function fortw_clear_page_cache() {
	if ( function_exists( 'wp_cache_clear_cache' ) ) {
		wp_cache_clear_cache();
	}
	do_action( 'fortw_page_cache_cleared' );
}

function fortw_approve( $post_id ) {
	// A submitter's proposed change is applied to its live event instead (admin-changes.php).
	$routed = apply_filters( 'fortw_approve_target', null, $post_id );
	if ( null !== $routed ) {
		return $routed;
	}
	return wp_update_post( array( 'ID' => $post_id, 'post_status' => 'publish' ), true );
}

function fortw_reject( $post_id, $reason ) {
	update_post_meta( $post_id, '_fort_reject_reason', sanitize_textarea_field( $reason ) );
	return wp_update_post( array( 'ID' => $post_id, 'post_status' => 'fort_rejected' ), true );
}

function fortw_archive( $post_id ) {
	$status = get_post_status( $post_id );
	if ( 'fort_archived' === $status ) {
		return $post_id;
	}
	update_post_meta( $post_id, '_fort_status_before_archive', $status );
	return wp_update_post( array( 'ID' => $post_id, 'post_status' => 'fort_archived' ), true );
}

/** Puts an archived event back where it was (pending if unknown). */
function fortw_restore( $post_id ) {
	$before = get_post_meta( $post_id, '_fort_status_before_archive', true );
	$status = in_array( $before, array( 'publish', 'pending', 'fort_rejected' ), true ) ? $before : 'pending';
	delete_post_meta( $post_id, '_fort_status_before_archive' );
	return wp_update_post( array( 'ID' => $post_id, 'post_status' => $status ), true );
}

/** "Don't miss": called out between Featured and This week until it reaches This week. */
function fortw_set_callout( $post_id, $on ) {
	if ( $on ) {
		update_post_meta( $post_id, '_fort_callout', '1' );
	} else {
		delete_post_meta( $post_id, '_fort_callout' );
	}
}

function fortw_set_hold( $post_id, $on ) {
	if ( $on ) {
		update_post_meta( $post_id, '_fort_hold', '1' );
	} else {
		delete_post_meta( $post_id, '_fort_hold' );
	}
}

add_action(
	'transition_post_status',
	function ( $new, $old, $post ) {
		if ( FORTW_POST_TYPE !== $post->post_type || $new === $old ) {
			return;
		}
		if ( 'publish' === $new && ! fortw_importing() ) {
			// Approved now (re-approving after a rejection counts as new for the "NEW" marker).
			update_post_meta( $post->ID, '_fort_approved_at', current_time( 'mysql', true ) );
			delete_post_meta( $post->ID, '_fort_reject_reason' );
			// The edit screen's fields (e.g. "post a pre-blast") are saved after this hook, so the
			// approval's side effects run once the whole save is done.
			$GLOBALS['fortw_just_approved'][ $post->ID ] = true;
		}
		if ( 'publish' === $new || 'publish' === $old ) {
			fortw_clear_page_cache();
		}
	},
	10,
	3
);

add_action(
	'wp_after_insert_post',
	function ( $post_id ) {
		if ( ! empty( $GLOBALS['fortw_just_approved'][ $post_id ] ) ) {
			unset( $GLOBALS['fortw_just_approved'][ $post_id ] );
			do_action( 'fortw_event_approved', $post_id );
		}
	},
	20
);

// Edits to a published event, and changes to tags or region info, also need a fresh page cache.
add_action(
	'save_post_' . FORTW_POST_TYPE,
	function ( $post_id, $post ) {
		if ( 'publish' === $post->post_status && ! wp_is_post_revision( $post_id ) && ! fortw_importing() ) {
			fortw_clear_page_cache();
		}
	},
	20,
	2
);
add_action( 'update_option_fort_weekly_region', 'fortw_clear_page_cache' );
add_action( 'edited_' . FORTW_TAX, 'fortw_clear_page_cache' );

/** The number of events waiting for approval. */
function fortw_pending_count() {
	$counts = wp_count_posts( FORTW_POST_TYPE );
	return isset( $counts->pending ) ? (int) $counts->pending : 0;
}

// Fort editors (who can't edit blog posts) land on the events list after logging in, on the
// approval queue when something is waiting, instead of WordPress's profile page.
add_filter(
	'login_redirect',
	function ( $redirect, $requested, $user ) {
		if ( $user instanceof WP_User && $user->has_cap( 'edit_fort_events' ) && ! $user->has_cap( 'edit_posts' )
			&& ( '' === $requested || admin_url() === $requested || admin_url( 'profile.php' ) === $redirect ) ) {
			return admin_url( 'edit.php?post_type=' . FORTW_POST_TYPE . ( fortw_pending_count() ? '&post_status=pending' : '' ) );
		}
		return $redirect;
	},
	10,
	3
);

// ── Pre-blast: posted when an event that asked for one is approved ──────

add_action( 'fortw_event_approved', 'fortw_maybe_post_preblast' );

/**
 * Creates the Pre-Blast post for an approved event that requested one (once). It goes in the
 * Pre-Blast category and, when "Where" matches an existing category (the AO), that one too. No
 * new categories are made from free text. Returns the post id, 0 if none was needed, or WP_Error.
 */
function fortw_maybe_post_preblast( $post_id ) {
	if ( fortw_importing() || ! get_post_meta( $post_id, '_fort_preblast_requested', true ) || get_post_meta( $post_id, '_fort_preblast_post_id', true ) ) {
		return 0;
	}
	$e   = fortw_entry( $post_id );
	$cat = get_cat_ID( 'Pre-Blast' );
	if ( ! $cat ) {
		$made = wp_insert_term( 'Pre-Blast', 'category' );
		$cat  = is_wp_error( $made ) ? 0 : (int) $made['term_id'];
	}
	$cats = array_filter( array( $cat ) );
	if ( $e['location'] ) {
		$ao = get_term_by( 'name', $e['location'], 'category' );
		if ( $ao ) {
			$cats[] = (int) $ao->term_id;
		}
	}
	$custom  = (string) get_post_meta( $post_id, '_fort_preblast_content', true );
	$content = '' !== trim( $custom ) ? $custom : $e['description'];
	$content .= "\n" . '<p><a href="' . esc_url( get_permalink( $post_id ) ) . '">' . esc_html__( 'Event details', 'fort-weekly' ) . '</a>'
		. ( $e['link'] ? ' · <a href="' . esc_url( $e['link'] ) . '">' . esc_html__( 'Sign up', 'fort-weekly' ) . '</a>' : '' ) . '</p>';
	$pre = wp_insert_post(
		array(
			'post_type'     => 'post',
			'post_status'   => 'publish',
			'post_title'    => $e['title'],
			'post_content'  => wp_kses_post( $content ),
			'post_category' => $cats,
			'post_author'   => get_current_user_id(),
		),
		true
	);
	if ( is_wp_error( $pre ) ) {
		error_log( 'Fort Weekly: pre-blast post failed: ' . $pre->get_error_message() );
		return $pre;
	}
	// The fields the site's backblast/pre-blast posts carry (as the app's REST post set them).
	if ( $e['leader'] ) {
		update_post_meta( $pre, 'qic', $e['leader'] );
	}
	if ( $e['next_occurrence'] ) {
		update_post_meta( $pre, 'workout_date', gmdate( 'm/d/Y', strtotime( $e['next_occurrence']['date'] . ' 00:00:00 UTC' ) ) );
	}
	update_post_meta( $post_id, '_fort_preblast_post_id', (int) $pre );
	return (int) $pre;
}

