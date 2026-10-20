<?php
/**
 * Fort Weekly → Import: upload the newsletter app's export and import it (administrators only).
 * The same import as `wp fort-weekly import`, for hosts without a command line.
 *
 * @package FortWeekly
 */

defined( 'ABSPATH' ) || exit;

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

function fortw_render_import_page() {
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( esc_html__( 'Sorry, you are not allowed to do that.', 'fort-weekly' ) );
	}
	$report = null;
	$error  = '';
	if ( 'POST' === ( $_SERVER['REQUEST_METHOD'] ?? '' ) ) {
		check_admin_referer( 'fortw_import' );
		$file = $_FILES['fortw_export'] ?? null; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
		if ( ! $file || UPLOAD_ERR_OK !== (int) $file['error'] || ! is_uploaded_file( $file['tmp_name'] ) ) {
			$error = __( 'Choose the export file to upload.', 'fort-weekly' );
		} elseif ( $file['size'] > 20 * MB_IN_BYTES ) {
			$error = __( 'That file is too large to be an export.', 'fort-weekly' );
		} else {
			$data = json_decode( file_get_contents( $file['tmp_name'] ), true ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
			$base = esc_url_raw( wp_unslash( $_POST['fortw_uploads_base'] ?? '' ) );
			$report = fortw_import(
				$data,
				array(
					'dry_run'      => ! empty( $_POST['fortw_dry_run'] ),
					'uploads_base' => $base ? $base : 'https://submit.f3thefort.com',
				)
			);
		}
	}
	?>
	<div class="wrap">
		<h1><?php esc_html_e( 'Import from the newsletter app', 'fort-weekly' ); ?></h1>
		<p><?php esc_html_e( 'Imports events, tags, the Nan\'tan note and region info from the app\'s export file (scripts/export-for-wordpress.mjs). Safe to run again: events already imported are updated, not duplicated. Start with a dry run.', 'fort-weekly' ); ?></p>
		<p><strong><?php esc_html_e( 'The export contains submitters\' emails and phone numbers. Delete it after importing.', 'fort-weekly' ); ?></strong></p>

		<?php if ( $error ) : ?>
			<div class="notice notice-error"><p><?php echo esc_html( $error ); ?></p></div>
		<?php endif; ?>
		<?php if ( $report ) : ?>
			<div class="notice <?php echo $report['warnings'] ? 'notice-warning' : 'notice-success'; ?>">
				<p><strong><?php echo ! empty( $_POST['fortw_dry_run'] ) ? esc_html__( 'Dry run — nothing was changed.', 'fort-weekly' ) : esc_html__( 'Import finished.', 'fort-weekly' ); ?></strong></p>
				<ul>
					<?php /* translators: 1: created, 2: updated */ ?>
					<li><?php echo esc_html( sprintf( __( 'Events: %1$d new, %2$d updated', 'fort-weekly' ), $report['events_created'], $report['events_updated'] ) ); ?></li>
					<?php /* translators: 1: created, 2: updated */ ?>
					<li><?php echo esc_html( sprintf( __( 'Tags: %1$d new, %2$d updated', 'fort-weekly' ), $report['tags_created'], $report['tags_updated'] ) ); ?></li>
					<?php /* translators: 1: copied, 2: reused */ ?>
					<li><?php echo esc_html( sprintf( __( 'Images: %1$d copied, %2$d already here', 'fort-weekly' ), $report['images_copied'], $report['images_reused'] ) ); ?></li>
					<li><?php echo $report['region'] ? esc_html__( 'Region info: replaced', 'fort-weekly' ) : esc_html__( 'Region info: not in the file', 'fort-weekly' ); ?></li>
				</ul>
				<?php foreach ( $report['warnings'] as $w ) : ?>
					<p><?php echo esc_html( $w ); ?></p>
				<?php endforeach; ?>
			</div>
		<?php endif; ?>

		<form method="post" enctype="multipart/form-data">
			<?php wp_nonce_field( 'fortw_import' ); ?>
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
					<th scope="row"><?php esc_html_e( 'Dry run', 'fort-weekly' ); ?></th>
					<td><label><input type="checkbox" name="fortw_dry_run" value="1" checked> <?php esc_html_e( 'Only report what would change', 'fort-weekly' ); ?></label></td>
				</tr>
			</table>
			<?php submit_button( __( 'Import', 'fort-weekly' ) ); ?>
		</form>
	</div>
	<?php
}
