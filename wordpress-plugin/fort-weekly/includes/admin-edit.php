<?php
/**
 * The event edit screen: boxes for dates, details, newsletter, approval, pre-blast and the
 * submitter, and saving them. The description is the post content; the flyer is the featured
 * image; tags are the usual checkbox box.
 *
 * @package FortWeekly
 */

defined( 'ABSPATH' ) || exit;

add_action(
	'add_meta_boxes_' . FORTW_POST_TYPE,
	function ( $post ) {
		add_meta_box( 'fortw_dates', __( 'Dates', 'fort-weekly' ), 'fortw_box_dates', null, 'normal', 'high' );
		add_meta_box( 'fortw_details', __( 'Details', 'fort-weekly' ), 'fortw_box_details', null, 'normal', 'high' );
		add_meta_box( 'fortw_newsletter', __( 'Newsletter', 'fort-weekly' ), 'fortw_box_newsletter', null, 'normal', 'default' );
		add_meta_box( 'fortw_approval', __( 'Approval', 'fort-weekly' ), 'fortw_box_approval', null, 'side', 'high' );
		add_meta_box( 'fortw_preblast', __( 'Pre-blast', 'fort-weekly' ), 'fortw_box_preblast', null, 'side', 'default' );
		add_meta_box( 'fortw_submitter', __( 'Submitted by (editors only)', 'fort-weekly' ), 'fortw_box_submitter', null, 'side', 'default' );

		// The flyer: right under Publish, not at the bottom of the column where WordPress puts it.
		global $wp_meta_boxes;
		$side = &$wp_meta_boxes[ FORTW_POST_TYPE ]['side'];
		if ( isset( $side['low']['postimagediv'], $side['core'] ) ) {
			$box = $side['low']['postimagediv'];
			unset( $side['low']['postimagediv'] );
			$core = array();
			foreach ( $side['core'] as $id => $b ) {
				$core[ $id ] = $b;
				if ( 'submitdiv' === $id ) {
					$core['postimagediv'] = $box;
				}
			}
			$side['core'] = $core + array( 'postimagediv' => $box );
		}
	}
);

function fortw_box_dates( $post ) {
	wp_nonce_field( 'fortw_edit_' . $post->ID, 'fortw_edit_nonce' );
	$occ = fortw_get_occurrences( $post->ID );
	$occ[] = array( 'date' => '', 'start_time' => '', 'end_time' => '' ); // One blank row to add a date.
	?>
	<p class="description"><?php esc_html_e( 'One row per date. No dates at all = an ongoing item. Times are free text like 0530 or 1730–1930.', 'fort-weekly' ); ?></p>
	<table class="fortw-rows widefat striped" data-fortw-rows="occ">
		<thead><tr><th><?php esc_html_e( 'Date', 'fort-weekly' ); ?></th><th><?php esc_html_e( 'Start', 'fort-weekly' ); ?></th><th><?php esc_html_e( 'End', 'fort-weekly' ); ?></th><th></th></tr></thead>
		<tbody>
			<?php foreach ( $occ as $i => $o ) : ?>
				<tr>
					<td><input type="date" name="fortw_occ[<?php echo (int) $i; ?>][date]" value="<?php echo esc_attr( $o['date'] ); ?>"></td>
					<td><input type="text" name="fortw_occ[<?php echo (int) $i; ?>][start_time]" value="<?php echo esc_attr( (string) $o['start_time'] ); ?>" placeholder="0530" maxlength="40" size="10"></td>
					<td><input type="text" name="fortw_occ[<?php echo (int) $i; ?>][end_time]" value="<?php echo esc_attr( (string) $o['end_time'] ); ?>" placeholder="0630" maxlength="40" size="10"></td>
					<td><button type="button" class="button-link fortw-remove-row" aria-label="<?php esc_attr_e( 'Remove this date', 'fort-weekly' ); ?>">✕</button></td>
				</tr>
			<?php endforeach; ?>
		</tbody>
	</table>
	<p><button type="button" class="button fortw-add-row" data-fortw-target="occ"><?php esc_html_e( 'Add a date', 'fort-weekly' ); ?></button></p>
	<?php
}

function fortw_box_details( $post ) {
	$fields = array(
		'_fort_leader'    => array( __( 'Q (who’s leading)', 'fort-weekly' ), 'text', 120 ),
		'_fort_location'  => array( __( 'Where', 'fort-weekly' ), 'text', 200 ),
		'_fort_link'      => array( __( 'Sign-up or details link', 'fort-weekly' ), 'url', 1000 ),
		'_fort_video_url' => array( __( 'Video link', 'fort-weekly' ), 'url', 1000 ),
	);
	echo '<table class="form-table" role="presentation">';
	foreach ( $fields as $key => $f ) {
		printf(
			'<tr><th scope="row"><label for="%1$s">%2$s</label></th><td><input type="%3$s" id="%1$s" name="%1$s" value="%4$s" maxlength="%5$d" class="regular-text"%6$s></td></tr>',
			esc_attr( $key ),
			esc_html( $f[0] ),
			esc_attr( $f[1] ),
			esc_attr( (string) get_post_meta( $post->ID, $key, true ) ),
			(int) $f[2],
			'url' === $f[1] ? ' placeholder="https://…"' : ''
		);
	}
	echo '</table>';
}

function fortw_box_newsletter( $post ) {
	$summary = (string) get_post_meta( $post->ID, '_fort_summary', true );
	$can_gen = fortw_groq_configured();
	?>
	<p><label for="fortw-summary"><strong><?php esc_html_e( 'Summary', 'fort-weekly' ); ?></strong></label>
		<span class="description"><?php esc_html_e( 'A sentence or two for the newsletter and the homepage. Empty = the start of the description.', 'fort-weekly' ); ?></span></p>
	<textarea id="fortw-summary" name="_fort_summary" rows="3" class="large-text" maxlength="400"><?php echo esc_textarea( $summary ); ?></textarea>
	<p>
		<button type="button" class="button" id="fortw-generate" <?php disabled( ! $can_gen ); ?> data-post="<?php echo (int) $post->ID; ?>" data-nonce="<?php echo esc_attr( wp_create_nonce( 'fortw_summary_' . $post->ID ) ); ?>"><?php esc_html_e( 'Write one for me', 'fort-weekly' ); ?></button>
		<?php if ( ! $can_gen ) : ?>
			<span class="description"><?php esc_html_e( 'Needs FORT_GROQ_API_KEY in wp-config.php.', 'fort-weekly' ); ?></span>
		<?php endif; ?>
		<span id="fortw-generate-status" class="description" role="status"></span>
	</p>
	<p><label><input type="checkbox" name="_fort_featured" value="1" <?php checked( (bool) get_post_meta( $post->ID, '_fort_featured', true ) ); ?>> <?php esc_html_e( 'Featured — the big card at the top of the site and the newsletter (only one event at a time)', 'fort-weekly' ); ?></label></p>
	<p><label><input type="checkbox" name="_fort_hold" value="1" <?php checked( (bool) get_post_meta( $post->ID, '_fort_hold', true ) ); ?>> <?php esc_html_e( 'Hold from the newsletter — still shown on the site', 'fort-weekly' ); ?></label></p>
	<?php
}

function fortw_box_approval( $post ) {
	$e = fortw_entry( $post );
	switch ( $post->post_status ) {
		case 'publish':
			$at = $e['approved_at'] ? get_date_from_gmt( $e['approved_at'], 'M j, Y g:ia' ) : '';
			/* translators: %s: date and time */
			echo '<p><span class="fortw-status fortw-status--ok">' . esc_html__( 'Approved', 'fort-weekly' ) . '</span> ' . ( $at ? esc_html( sprintf( __( 'on %s', 'fort-weekly' ), $at ) ) : '' ) . '</p>';
			echo '<p>' . esc_html__( 'On the site now, and in each newsletter until its dates have passed.', 'fort-weekly' ) . '</p>';
			break;
		case 'fort_rejected':
			echo '<p><span class="fortw-status fortw-status--bad">' . esc_html__( 'Rejected', 'fort-weekly' ) . '</span></p>';
			if ( $e['reject_reason'] ) {
				echo '<p>' . esc_html( $e['reject_reason'] ) . '</p>';
			}
			break;
		case 'fort_archived':
			echo '<p><span class="fortw-status">' . esc_html__( 'Archived', 'fort-weekly' ) . '</span></p>';
			break;
		default:
			echo '<p><span class="fortw-status fortw-status--wait">' . esc_html__( 'Needs approval', 'fort-weekly' ) . '</span></p>';
			echo '<p>' . esc_html__( 'Not on the site yet. “Publish” approves it: it appears on the site right away and goes in the next newsletter.', 'fort-weekly' ) . '</p>';
	}
	if ( in_array( $post->post_status, array( 'pending', 'publish' ), true ) ) {
		printf( '<p><a href="%s">%s</a></p>', esc_url( admin_url( 'admin.php?page=fortw-reject&post=' . $post->ID ) ), esc_html__( 'Reject…', 'fort-weekly' ) );
	}
	if ( $e['origin'] ) {
		/* translators: %s: where the event came from */
		echo '<p class="description">' . esc_html( sprintf( __( 'Came from: %s', 'fort-weekly' ), $e['origin'] ) ) . '</p>';
	}
}

function fortw_box_preblast( $post ) {
	$requested = (bool) get_post_meta( $post->ID, '_fort_preblast_requested', true );
	$pre       = (int) get_post_meta( $post->ID, '_fort_preblast_post_id', true );
	if ( $pre && get_post( $pre ) ) {
		printf( '<p>%s <a href="%s">%s</a></p>', esc_html__( 'Pre-blast posted:', 'fort-weekly' ), esc_url( get_edit_post_link( $pre ) ), esc_html( get_the_title( $pre ) ) );
		return;
	}
	?>
	<p><label><input type="checkbox" name="_fort_preblast_requested" value="1" <?php checked( $requested ); ?>> <?php esc_html_e( 'Post a pre-blast when this is approved', 'fort-weekly' ); ?></label></p>
	<p class="description"><?php esc_html_e( 'Creates a post in the Pre-Blast category (and the AO’s category, if one matches “Where”).', 'fort-weekly' ); ?></p>
	<?php
}

function fortw_box_submitter( $post ) {
	$who = fortw_entry_private( $post->ID );
	foreach ( array( 'name' => __( 'F3 name', 'fort-weekly' ), 'email' => __( 'Email', 'fort-weekly' ), 'phone' => __( 'Phone', 'fort-weekly' ) ) as $k => $label ) {
		printf(
			'<p><label for="fortw-sub-%1$s">%2$s</label><br><input type="%3$s" id="fortw-sub-%1$s" name="_fort_submitter_%1$s" value="%4$s" class="widefat" maxlength="200"></p>',
			esc_attr( $k ),
			esc_html( $label ),
			'email' === $k ? 'email' : 'text',
			esc_attr( (string) $who[ $k ] )
		);
	}
	do_action( 'fortw_submitter_box_end', $post );
}

/** Saving the boxes. Bad dates keep the old ones and show a notice. */
add_action(
	'save_post_' . FORTW_POST_TYPE,
	function ( $post_id ) {
		if ( ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) || wp_is_post_revision( $post_id ) || fortw_importing() ) {
			return;
		}
		if ( ! isset( $_POST['fortw_edit_nonce'] ) || ! wp_verify_nonce( sanitize_key( wp_unslash( $_POST['fortw_edit_nonce'] ) ), 'fortw_edit_' . $post_id ) ) {
			return;
		}
		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			return;
		}
		$post = wp_unslash( $_POST ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput -- each field sanitized below

		$rows = array();
		foreach ( (array) ( $post['fortw_occ'] ?? array() ) as $row ) {
			if ( '' !== trim( (string) ( $row['date'] ?? '' ) ) ) {
				$rows[] = array( 'date' => (string) $row['date'], 'start_time' => sanitize_text_field( (string) ( $row['start_time'] ?? '' ) ), 'end_time' => sanitize_text_field( (string) ( $row['end_time'] ?? '' ) ) );
			}
		}
		try {
			fortw_set_occurrences( $post_id, $rows );
		} catch ( InvalidArgumentException $e ) {
			set_transient( 'fortw_notice_' . get_current_user_id(), $e->getMessage() . ' — ' . __( 'the dates were not changed.', 'fort-weekly' ), 60 );
		}

		foreach ( array( '_fort_leader' => 120, '_fort_location' => 200, '_fort_submitter_name' => 120, '_fort_submitter_phone' => 40 ) as $key => $max ) {
			fortw_update_or_delete( $post_id, $key, mb_substr( sanitize_text_field( (string) ( $post[ $key ] ?? '' ) ), 0, $max ) );
		}
		fortw_update_or_delete( $post_id, '_fort_submitter_email', sanitize_email( (string) ( $post['_fort_submitter_email'] ?? '' ) ) );
		fortw_update_or_delete( $post_id, '_fort_summary', mb_substr( sanitize_textarea_field( (string) ( $post['_fort_summary'] ?? '' ) ), 0, 400 ) );
		foreach ( array( '_fort_link', '_fort_video_url' ) as $key ) {
			fortw_update_or_delete( $post_id, $key, fortw_http_url( (string) ( $post[ $key ] ?? '' ) ) );
		}
		if ( ! fortw_is_change( $post_id ) ) { // A proposal has no Newsletter box (see admin-changes.php).
			fortw_set_featured( $post_id, ! empty( $post['_fort_featured'] ) );
			fortw_set_hold( $post_id, ! empty( $post['_fort_hold'] ) );
		}
		if ( ! get_post_meta( $post_id, '_fort_preblast_post_id', true ) ) {
			fortw_update_or_delete( $post_id, '_fort_preblast_requested', empty( $post['_fort_preblast_requested'] ) ? '' : '1' );
		}
		if ( ! get_post_meta( $post_id, '_fort_origin', true ) ) {
			update_post_meta( $post_id, '_fort_origin', 'admin' );
		}
	}
);

function fortw_update_or_delete( $post_id, $key, $value ) {
	if ( '' === $value || null === $value ) {
		delete_post_meta( $post_id, $key );
	} else {
		update_post_meta( $post_id, $key, $value );
	}
}

add_action(
	'admin_notices',
	function () {
		$msg = get_transient( 'fortw_notice_' . get_current_user_id() );
		if ( $msg ) {
			delete_transient( 'fortw_notice_' . get_current_user_id() );
			echo '<div class="notice notice-error"><p>' . esc_html( $msg ) . '</p></div>';
		}
	}
);

// "Write one for me": a summary from Groq, from the title and description.
add_action(
	'wp_ajax_fortw_summary',
	function () {
		$post_id = isset( $_POST['post'] ) ? (int) $_POST['post'] : 0;
		check_ajax_referer( 'fortw_summary_' . $post_id, 'nonce' );
		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			wp_send_json_error( array( 'message' => __( 'Not allowed.', 'fort-weekly' ) ), 403 );
		}
		$title = sanitize_text_field( wp_unslash( $_POST['title'] ?? '' ) );
		$text  = wp_strip_all_tags( wp_unslash( $_POST['content'] ?? '' ) ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
		$out   = fortw_groq_summary( $title, mb_substr( $text, 0, 6000 ) );
		if ( is_wp_error( $out ) ) {
			wp_send_json_error( array( 'message' => $out->get_error_message() ), 502 );
		}
		wp_send_json_success( array( 'summary' => $out ) );
	}
);

add_action(
	'admin_enqueue_scripts',
	function ( $hook ) {
		$screen = get_current_screen();
		if ( ! $screen || ( FORTW_POST_TYPE !== $screen->post_type && false === strpos( $hook, 'fortw' ) ) ) {
			return;
		}
		wp_enqueue_style( 'fortw-admin', plugins_url( 'assets/admin.css', FORT_WEEKLY_FILE ), array(), FORT_WEEKLY_VERSION );
		wp_enqueue_script( 'fortw-admin', plugins_url( 'assets/admin.js', FORT_WEEKLY_FILE ), array(), FORT_WEEKLY_VERSION, true );
		if ( false !== strpos( $hook, 'fortw-nantan' ) ) { // The Nan'tan's image picker.
			wp_enqueue_media();
		}
	}
);
