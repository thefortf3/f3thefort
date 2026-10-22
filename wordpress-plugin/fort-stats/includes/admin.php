<?php
/**
 * Settings → Fort Stats: the FNG sheet and challenge dates (not secrets; they change per
 * challenge), whether the connection is set up, and "Refresh now".
 *
 * @package FortStats
 */

defined( 'ABSPATH' ) || exit;

add_action(
	'admin_menu',
	function () {
		add_options_page( __( 'Fort Stats', 'fort-stats' ), __( 'Fort Stats', 'fort-stats' ), 'manage_options', 'fort-stats', 'fstats_settings_page' );
	}
);

add_action(
	'admin_init',
	function () {
		foreach ( array( 'fng_sheet_url' => 'esc_url_raw', 'fng_start' => 'fstats_sanitize_date', 'fng_end' => 'fstats_sanitize_date' ) as $name => $clean ) {
			register_setting( 'fort-stats', 'fstats_' . $name, array( 'type' => 'string', 'sanitize_callback' => $clean, 'default' => '' ) );
		}
	}
);

function fstats_sanitize_date( $v ) {
	$v = trim( (string) $v );
	return preg_match( '/^\d{4}-\d{2}-\d{2}$/', $v ) ? $v : '';
}

add_action(
	'admin_post_fstats_refresh',
	function () {
		check_admin_referer( 'fstats_refresh' );
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'Sorry, you are not allowed to do that.', 'fort-stats' ), 403 );
		}
		fstats_flush_cache();
		$result = fstats_refresh( true );
		$failed = array_filter( $result, fn( $r ) => 'ok' !== $r && 'kept' !== $r );
		wp_safe_redirect( admin_url( 'options-general.php?page=fort-stats&refreshed=' . ( $failed ? 'partly' : '1' ) ) );
		exit;
	}
);

function fstats_settings_page() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	$checks = array(
		__( 'Stats database (FORT_STATS_REST_URL, FORT_STATS_ANON_KEY)', 'fort-stats' ) => fstats_configured(),
		__( 'Q schedule (FORT_GS_API_ENDPOINT, FORT_GS_API_KEY)', 'fort-stats' )        => (bool) FStats_GloomSchedule::from_config(),
		__( 'FNG sheet', 'fort-stats' )                                                => '' !== fstats_setting( 'fng_sheet_url' ),
	);
	?>
	<div class="wrap">
		<h1><?php esc_html_e( 'Fort Stats', 'fort-stats' ); ?></h1>
		<?php if ( isset( $_GET['refreshed'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification.Recommended ?>
			<?php if ( 'partly' === $_GET['refreshed'] ) : // phpcs:ignore WordPress.Security.NonceVerification.Recommended ?>
				<div class="notice notice-warning"><p><?php esc_html_e( 'Refreshed, but some sources couldn’t be reached; their last copies are still shown. Details are in the PHP error log.', 'fort-stats' ); ?></p></div>
			<?php else : ?>
				<div class="notice notice-success"><p><?php esc_html_e( 'Stats refreshed.', 'fort-stats' ); ?></p></div>
			<?php endif; ?>
		<?php endif; ?>
		<p><?php echo wp_kses_post( sprintf( /* translators: %s: link */ __( 'The stats pages are at %s.', 'fort-stats' ), '<a href="' . esc_url( home_url( '/stats/' ) ) . '">' . esc_html( home_url( '/stats/' ) ) . '</a>' ) ); ?></p>
		<table class="widefat striped" style="max-width:720px"><tbody>
			<?php foreach ( $checks as $label => $ok ) : ?>
				<tr><td><?php echo esc_html( $label ); ?></td><td><?php echo $ok ? '✓ ' . esc_html__( 'set up', 'fort-stats' ) : '✗ ' . esc_html__( 'not set', 'fort-stats' ); ?></td></tr>
			<?php endforeach; ?>
		</tbody></table>

		<form method="post" action="options.php">
			<?php settings_fields( 'fort-stats' ); ?>
			<h2><?php esc_html_e( 'FNGs', 'fort-stats' ); ?></h2>
			<table class="form-table" role="presentation">
				<tr><th><label for="fstats_fng_sheet_url"><?php esc_html_e( 'Sign-up sheet (published CSV link)', 'fort-stats' ); ?></label></th>
					<td><input class="large-text" type="url" id="fstats_fng_sheet_url" name="fstats_fng_sheet_url" value="<?php echo esc_attr( get_option( 'fstats_fng_sheet_url', '' ) ); ?>"></td></tr>
				<tr><th><label for="fstats_fng_start"><?php esc_html_e( 'FNG challenge', 'fort-stats' ); ?></label></th>
					<td><input type="date" id="fstats_fng_start" name="fstats_fng_start" value="<?php echo esc_attr( get_option( 'fstats_fng_start', '' ) ); ?>"> –
						<input type="date" name="fstats_fng_end" value="<?php echo esc_attr( get_option( 'fstats_fng_end', '' ) ); ?>" aria-label="<?php esc_attr_e( 'Challenge end', 'fort-stats' ); ?>">
						<p class="description"><?php esc_html_e( 'The dates the /stats/fng-challenge/ board counts.', 'fort-stats' ); ?></p></td></tr>
			</table>
			<?php submit_button(); ?>
		</form>

		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
			<input type="hidden" name="action" value="fstats_refresh">
			<?php wp_nonce_field( 'fstats_refresh' ); ?>
			<p>
				<?php
				$at = fstats_kept_at( 'core' );
				/* translators: %s: time ago */
				echo esc_html( $at ? sprintf( __( 'Stats last fetched %s ago; the schedule every 10 minutes, the rest hourly, in the background.', 'fort-stats' ), human_time_diff( $at ) ) : __( 'Stats haven’t been fetched yet.', 'fort-stats' ) );
				?>
				<?php submit_button( __( 'Refresh now', 'fort-stats' ), 'secondary', 'submit', false ); ?></p>
		</form>
	</div>
	<?php
}

// New FNG sheet or challenge dates: drop the copies built from the old ones and fetch again.
foreach ( array( 'fstats_fng_sheet_url', 'fstats_fng_start', 'fstats_fng_end' ) as $fstats_opt ) {
	add_action(
		'update_option_' . $fstats_opt,
		function () {
			delete_option( 'fstats_kept_fng_challenge' );
			if ( doing_action( 'update_option_fstats_fng_sheet_url' ) ) {
				delete_option( 'fstats_kept_fng_sheet' );
				delete_option( 'fstats_kept_fng' );
			}
			fstats_request_refresh();
		}
	);
}
