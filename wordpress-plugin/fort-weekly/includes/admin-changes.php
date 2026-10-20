<?php
/**
 * wp-admin for submitter edits: proposed changes in the approval queue (labelled, with what
 * changed), a before/after comparison on the change's screen, a notice on the live event, and the
 * submitter's edit link (copy / reset) in the "Submitted by" box.
 *
 * @package FortWeekly
 */

defined( 'ABSPATH' ) || exit;

/** An event or change as plain values for comparing (see fortw_change_rows()). */
function fortw_change_snapshot( $post_id ) {
	$post = get_post( $post_id );
	$m    = function ( $key ) use ( $post_id ) {
		return (string) get_post_meta( $post_id, $key, true );
	};
	return array(
		'title' => $post->post_title,
		'text'  => trim( html_entity_decode( wp_strip_all_tags( $post->post_content ), ENT_QUOTES, 'UTF-8' ) ),
		'when'  => fortw_when_text( fortw_get_occurrences( $post_id ) ),
		'where' => $m( '_fort_location' ),
		'q'     => $m( '_fort_leader' ),
		'link'  => $m( '_fort_link' ),
		'flyer' => (string) fortw_hero_url( $post_id ),
		'name'  => $m( '_fort_submitter_name' ),
		'email' => $m( '_fort_submitter_email' ),
		'phone' => $m( '_fort_submitter_phone' ),
	);
}

/** What a change post alters on its live event. */
function fortw_change_compare( $change_id ) {
	$event_id = (int) get_post_meta( $change_id, '_fort_change_of', true );
	return $event_id && get_post( $event_id ) ? fortw_change_rows( fortw_change_snapshot( $event_id ), fortw_change_snapshot( $change_id ) ) : array();
}

// Approving a change (row action, bulk action) applies it rather than publishing a second event.
add_filter(
	'fortw_approve_target',
	function ( $result, $post_id ) {
		return fortw_is_change( $post_id ) ? fortw_apply_change( $post_id ) : $result;
	},
	10,
	2
);

// The queue's Details column for a change: what it changes.
add_filter(
	'fortw_queue_details',
	function ( $html, $post_id ) {
		if ( ! fortw_is_change( $post_id ) ) {
			return $html;
		}
		$rows  = fortw_change_compare( $post_id );
		$event = (int) get_post_meta( $post_id, '_fort_change_of', true );
		$what  = $rows ? implode( ', ', array_map( function ( $r ) { return strtolower( $r[0] ); }, $rows ) ) : __( 'nothing (same as now)', 'fort-weekly' );
		return '<p class="fortw-excerpt"><strong>' . esc_html__( 'Change to a live event.', 'fort-weekly' ) . '</strong> '
			/* translators: %s: list of changed fields */
			. esc_html( sprintf( __( 'Changes: %s.', 'fort-weekly' ), $what ) ) . '</p>'
			. '<p class="fortw-dim"><a href="' . esc_url( get_edit_post_link( $post_id ) ) . '">' . esc_html__( 'Compare before / after', 'fort-weekly' ) . '</a> · <a href="' . esc_url( get_permalink( $event ) ) . '">' . esc_html__( 'Live version', 'fort-weekly' ) . ' ↗</a></p>';
	},
	10,
	2
);

add_filter(
	'display_post_states',
	function ( $states, $post ) {
		if ( FORTW_POST_TYPE === $post->post_type && fortw_is_change( $post->ID ) ) {
			$states['fortw_change'] = __( 'Change to live event', 'fort-weekly' );
		}
		return $states;
	},
	20,
	2
);

add_filter(
	'post_row_actions',
	function ( $actions, $post ) {
		if ( FORTW_POST_TYPE === $post->post_type && fortw_is_change( $post->ID ) && isset( $actions['fortw_approve'] ) ) {
			$actions['fortw_approve'] = str_replace( '>' . esc_html__( 'Approve', 'fort-weekly' ) . '<', '>' . esc_html__( 'Approve change', 'fort-weekly' ) . '<', $actions['fortw_approve'] );
			unset( $actions['fortw_archive'] );
		}
		return $actions;
	},
	20,
	2
);

// ── The change's edit screen: before / after ───────────────────────────

add_action(
	'add_meta_boxes_' . FORTW_POST_TYPE,
	function ( $post ) {
		if ( fortw_is_change( $post->ID ) ) {
			add_meta_box( 'fortw_change', __( 'Proposed change — before and after', 'fort-weekly' ), 'fortw_box_change', null, 'normal', 'high' );
		}
	},
	5
);

// Newsletter flags and the pre-blast belong to the live event, not to a proposal.
add_action(
	'add_meta_boxes_' . FORTW_POST_TYPE,
	function ( $post ) {
		if ( fortw_is_change( $post->ID ) ) {
			remove_meta_box( 'fortw_newsletter', FORTW_POST_TYPE, 'normal' );
			remove_meta_box( 'fortw_preblast', FORTW_POST_TYPE, 'side' );
		}
	},
	20
);

function fortw_box_change( $post ) {
	$event = (int) get_post_meta( $post->ID, '_fort_change_of', true );
	$rows  = fortw_change_compare( $post->ID );
	?>
	<p>
		<?php esc_html_e( 'The submitter proposed these changes to a live event. The live event is unchanged until you approve. “Publish” approves: the changes are copied onto it and this proposal goes away. You can adjust the fields below first.', 'fort-weekly' ); ?>
		<a href="<?php echo esc_url( get_edit_post_link( $event ) ); ?>"><?php esc_html_e( 'Open the live event', 'fort-weekly' ); ?></a>
	</p>
	<?php if ( ! $rows ) : ?>
		<p><em><?php esc_html_e( 'Nothing differs from the live event.', 'fort-weekly' ); ?></em></p>
	<?php else : ?>
		<table class="widefat striped fortw-diff">
			<thead><tr><th><?php esc_html_e( 'Field', 'fort-weekly' ); ?></th><th><?php esc_html_e( 'Live now', 'fort-weekly' ); ?></th><th><?php esc_html_e( 'Proposed', 'fort-weekly' ); ?></th></tr></thead>
			<tbody>
				<?php foreach ( $rows as $r ) : ?>
					<tr>
						<th scope="row"><?php echo esc_html( $r[0] ); ?></th>
						<?php foreach ( array( $r[1], $r[2] ) as $i => $value ) : ?>
							<td class="<?php echo $i ? 'fortw-diff__new' : 'fortw-diff__old'; ?>">
								<?php if ( 'Flyer' === $r[0] && $value ) : ?>
									<img src="<?php echo esc_url( $value ); ?>" alt="" class="fortw-thumb fortw-thumb--big">
								<?php else : ?>
									<?php echo '' === $value ? '<span class="fortw-dim">' . esc_html__( '(empty)', 'fort-weekly' ) . '</span>' : esc_html( wp_trim_words( $value, 80, '…' ) ); ?>
								<?php endif; ?>
							</td>
						<?php endforeach; ?>
					</tr>
				<?php endforeach; ?>
			</tbody>
		</table>
	<?php endif; ?>
	<?php
}

add_action(
	'admin_notices',
	function () {
		$screen = get_current_screen();
		if ( ! $screen || 'post' !== $screen->base || FORTW_POST_TYPE !== $screen->post_type ) {
			return;
		}
		$post_id = isset( $_GET['post'] ) ? (int) $_GET['post'] : 0; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		if ( isset( $_GET['fortw_change_applied'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			echo '<div class="notice notice-success is-dismissible"><p>' . esc_html__( 'Change approved: it’s on the live event now.', 'fort-weekly' ) . '</p></div>';
		}
		$change = $post_id && ! fortw_is_change( $post_id ) ? fortw_pending_change( $post_id ) : 0;
		if ( $change ) {
			printf(
				'<div class="notice notice-warning"><p>%s <a href="%s">%s</a></p></div>',
				esc_html__( 'The submitter has proposed changes to this event; they’re waiting for approval.', 'fort-weekly' ),
				esc_url( get_edit_post_link( $change ) ),
				esc_html__( 'Review the change', 'fort-weekly' )
			);
		}
	}
);

// ── The submitter's edit link, in the "Submitted by" box ───────────────

add_action(
	'fortw_submitter_box_end',
	function ( $post ) {
		if ( fortw_is_change( $post->ID ) || ! in_array( $post->post_status, array( 'publish', 'pending', 'draft' ), true ) ) {
			return;
		}
		$token = fortw_edit_token( $post->ID, false );
		?>
		<p class="fortw-editlink"><strong><?php esc_html_e( 'Edit link', 'fort-weekly' ); ?></strong><br>
			<?php if ( $token ) : ?>
				<input type="text" readonly class="widefat" value="<?php echo esc_attr( fortw_edit_url( $post->ID ) ); ?>" onclick="this.select()">
				<span class="description"><?php esc_html_e( 'The submitter’s private link for proposing changes. Resetting stops the old one working.', 'fort-weekly' ); ?></span><br>
			<?php else : ?>
				<span class="description"><?php esc_html_e( 'None yet (this event wasn’t submitted through the form).', 'fort-weekly' ); ?></span><br>
			<?php endif; ?>
			<a class="button button-small" href="<?php echo esc_url( wp_nonce_url( admin_url( 'admin-post.php?action=fortw_reset_link&post=' . $post->ID ), 'fortw_reset_link_' . $post->ID ) ); ?>"><?php echo $token ? esc_html__( 'Reset link', 'fort-weekly' ) : esc_html__( 'Create a link', 'fort-weekly' ); ?></a>
		</p>
		<?php
	}
);

add_action(
	'admin_post_fortw_reset_link',
	function () {
		$post_id = isset( $_GET['post'] ) ? (int) $_GET['post'] : 0;
		check_admin_referer( 'fortw_reset_link_' . $post_id );
		if ( ! current_user_can( 'edit_post', $post_id ) || FORTW_POST_TYPE !== get_post_type( $post_id ) ) {
			wp_die( esc_html__( 'Sorry, you are not allowed to do that.', 'fort-weekly' ), 403 );
		}
		fortw_reset_edit_token( $post_id );
		wp_safe_redirect( get_edit_post_link( $post_id, 'url' ) );
		exit;
	}
);
