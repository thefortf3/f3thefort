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
