<?php
/**
 * Fort Weekly → Import: upload the newsletter app's export and import it (administrators only).
 * The same import as `wp fort-weekly import`, for hosts without a command line.
 *
 * Shared hosting gives a page load only so long, and copying flyers is slow, so the import runs in
 * short steps: each page load works for STEP_SECONDS, saves where it got to, and the page moves
 * on to the next step by itself. If a page load dies anyway, this screen offers to carry on.
 *
 * @package FortWeekly
 */

defined( 'ABSPATH' ) || exit;

const FORTW_IMPORT_JOB          = 'fortw_import_job';
const FORTW_IMPORT_STEP_SECONDS = 20;

add_action(
	'admin_menu',
	function () {
		add_submenu_page(
			'edit.php?post_type=' . FORTW_POST_TYPE,
			__( 'Import from the newsletter app', 'fort-weekly' ),
			__( 'Import', 'fort-weekly' ),
			'manage_options',
			'fortw-import',
			'fortw_render_import_page'
		);
	},
	30
);

function fortw_save_import_job( $job ) {
	update_option( FORTW_IMPORT_JOB, $job, false );
}

function fortw_render_import_page() {
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( esc_html__( 'Sorry, you are not allowed to do that.', 'fort-weekly' ) );
	}
	$job   = get_option( FORTW_IMPORT_JOB );
	$job   = is_array( $job ) ? $job : null;
	$error = '';
	if ( 'POST' === ( $_SERVER['REQUEST_METHOD'] ?? '' ) ) {
		check_admin_referer( 'fortw_import' );
		$action = sanitize_key( wp_unslash( $_POST['fortw_action'] ?? 'start' ) );
		if ( 'cancel' === $action ) {
			delete_option( FORTW_IMPORT_JOB );
			$job = null;
		} elseif ( 'continue' === $action ) {
			if ( $job && 'done' !== $job['phase'] ) {
				fortw_import_run( $job, FORTW_IMPORT_STEP_SECONDS, 'fortw_save_import_job' );
				fortw_save_import_job( $job );
			}
		} else {
			$file = $_FILES['fortw_export'] ?? null; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
			if ( ! $file || UPLOAD_ERR_OK !== (int) $file['error'] || ! is_uploaded_file( $file['tmp_name'] ) ) {
				$error = __( 'Choose the export file to upload.', 'fort-weekly' );
			} elseif ( $file['size'] > 20 * MB_IN_BYTES ) {
				$error = __( 'That file is too large to be an export.', 'fort-weekly' );
			} else {
				$data = json_decode( file_get_contents( $file['tmp_name'] ), true ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
				$base = esc_url_raw( wp_unslash( $_POST['fortw_uploads_base'] ?? '' ) );
				$job  = fortw_import_start(
					$data,
					array(
						'dry_run'         => ! empty( $_POST['fortw_dry_run'] ),
						'update_existing' => ! empty( $_POST['fortw_update_existing'] ),
						'uploads_base'    => $base ? $base : 'https://submit.f3thefort.com',
					)
				);
				fortw_save_import_job( $job );
				fortw_import_run( $job, FORTW_IMPORT_STEP_SECONDS, 'fortw_save_import_job' );
				fortw_save_import_job( $job );
			}
		}
	}
	$running = $job && 'done' !== $job['phase'];
	if ( $job && ! $running ) {
		delete_option( FORTW_IMPORT_JOB ); // Shown once below; nothing of the export is kept.
	}
	// A page that has just done a step moves on by itself; one opened afresh (say, after a step
	// died) waits for Continue.
	$auto = $running && 'POST' === ( $_SERVER['REQUEST_METHOD'] ?? '' );
	?>
	<div class="wrap">
		<h1><?php esc_html_e( 'Import from the newsletter app', 'fort-weekly' ); ?></h1>

		<?php if ( $error ) : ?>
			<div class="notice notice-error"><p><?php echo esc_html( $error ); ?></p></div>
		<?php endif; ?>

		<?php if ( $job ) : ?>
			<?php
			$report = $job['report'];
			$dry    = $job['opts']['dry_run'];
			if ( $running ) {
				list( $done, $total ) = fortw_import_progress( $job );
				/* translators: 1: events done, 2: events in the file */
				$headline = sprintf( __( 'Importing: %1$d of %2$d events so far.', 'fort-weekly' ), $done, $total );
			} else {
				$headline = $dry ? __( 'Dry run — nothing was changed.', 'fort-weekly' ) : __( 'Import finished.', 'fort-weekly' );
			}
			?>
			<div class="notice <?php echo $running ? 'notice-info' : ( $report['warnings'] ? 'notice-warning' : 'notice-success' ); ?>">
				<p><strong><?php echo esc_html( $headline ); ?></strong></p>
				<ul>
					<?php /* translators: 1: created, 2: updated, 3: skipped */ ?>
					<li><?php echo esc_html( sprintf( __( 'Events: %1$d new, %2$d updated, %3$d already here (left alone)', 'fort-weekly' ), $report['events_created'], $report['events_updated'], $report['events_skipped'] ) ); ?></li>
					<?php /* translators: 1: created, 2: updated */ ?>
					<li><?php echo esc_html( sprintf( __( 'Tags: %1$d new, %2$d updated', 'fort-weekly' ), $report['tags_created'], $report['tags_updated'] ) ); ?></li>
					<?php /* translators: 1: copied, 2: reused */ ?>
					<li><?php echo esc_html( sprintf( __( 'Images: %1$d copied, %2$d already here', 'fort-weekly' ), $report['images_copied'], $report['images_reused'] ) ); ?></li>
					<?php if ( ! $running ) : ?>
						<li><?php echo $report['region'] ? esc_html__( 'Region info: replaced', 'fort-weekly' ) : esc_html__( 'Region info: left alone', 'fort-weekly' ); ?></li>
					<?php endif; ?>
				</ul>
				<?php foreach ( $report['warnings'] as $w ) : ?>
					<p><?php echo esc_html( $w ); ?></p>
				<?php endforeach; ?>
			</div>
		<?php endif; ?>

		<?php if ( $running ) : ?>
			<p>
				<?php
				echo $auto
					? esc_html__( 'Copying flyers takes a while. This page carries on by itself; leave it open until it says the import is finished.', 'fort-weekly' )
					: esc_html__( 'An import stopped part-way, perhaps because a page took too long. Carry on from where it stopped: nothing is done twice.', 'fort-weekly' );
				?>
			</p>
			<form method="post" id="fortw-import-continue" style="display:inline">
				<?php wp_nonce_field( 'fortw_import' ); ?>
				<input type="hidden" name="fortw_action" value="continue">
				<?php submit_button( __( 'Continue', 'fort-weekly' ), 'primary', 'fortw_continue', false ); // Not "submit": that would hide the form's submit() below. ?>
			</form>
			<form method="post" style="display:inline; margin-left:8px">
				<?php wp_nonce_field( 'fortw_import' ); ?>
				<input type="hidden" name="fortw_action" value="cancel">
				<?php submit_button( __( 'Stop the import', 'fort-weekly' ), 'secondary', 'fortw_stop', false ); ?>
			</form>
			<?php if ( $auto ) : ?>
				<script>
					setTimeout( function () { document.getElementById( 'fortw-import-continue' ).submit(); }, 500 );
				</script>
			<?php endif; ?>
		<?php else : ?>
			<p><?php esc_html_e( 'Imports events, tags, the Nan\'tan note and region info from the app\'s export file (scripts/export-for-wordpress.mjs). Safe to run again: events already here are left alone unless you choose to overwrite them. Start with a dry run.', 'fort-weekly' ); ?></p>
			<p><strong><?php esc_html_e( 'The export contains submitters\' emails and phone numbers. Delete it after importing.', 'fort-weekly' ); ?></strong></p>

			<form method="post" enctype="multipart/form-data">
				<?php wp_nonce_field( 'fortw_import' ); ?>
				<input type="hidden" name="fortw_action" value="start">
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="fortw_export"><?php esc_html_e( 'Export file', 'fort-weekly' ); ?></label></th>
						<td><input type="file" id="fortw_export" name="fortw_export" accept="application/json,.json" required></td>
					</tr>
					<tr>
						<th scope="row"><label for="fortw_uploads_base"><?php esc_html_e( 'App address (for images)', 'fort-weekly' ); ?></label></th>
						<td><input type="url" class="regular-text" id="fortw_uploads_base" name="fortw_uploads_base" value="https://submit.f3thefort.com">
							<p class="description"><?php esc_html_e( 'Flyers the app hosts are copied into the media library from here.', 'fort-weekly' ); ?></p></td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e( 'Already imported', 'fort-weekly' ); ?></th>
						<td><label><input type="checkbox" name="fortw_update_existing" value="1"> <?php esc_html_e( 'Overwrite events and region info imported before (undoes changes made here since)', 'fort-weekly' ); ?></label></td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e( 'Dry run', 'fort-weekly' ); ?></th>
						<td><label><input type="checkbox" name="fortw_dry_run" value="1" checked> <?php esc_html_e( 'Only report what would change', 'fort-weekly' ); ?></label></td>
					</tr>
				</table>
				<?php submit_button( __( 'Import', 'fort-weekly' ) ); ?>
			</form>
		<?php endif; ?>
	</div>
	<?php
}
