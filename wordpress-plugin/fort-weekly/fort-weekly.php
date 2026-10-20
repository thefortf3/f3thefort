<?php
/**
 * Plugin Name:       Fort Weekly
 * Plugin URI:        https://f3thefort.com
 * Description:       The Fort's events, approvals, region info and The Fort Weekly newsletter, inside WordPress. PAX submit events, editors approve them, and approved events appear on the site and in the next issue.
 * Version:           0.1.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            F3 The Fort
 * License:           GPL-2.0-or-later
 * Text Domain:       fort-weekly
 *
 * @package FortWeekly
 */

defined( 'ABSPATH' ) || exit;

define( 'FORT_WEEKLY_VERSION', '0.1.0' );
define( 'FORT_WEEKLY_FILE', __FILE__ );
define( 'FORT_WEEKLY_DIR', __DIR__ );

foreach ( glob( __DIR__ . '/includes/pure/*.php' ) as $fortw_file ) {
	require_once $fortw_file;
}
require_once __DIR__ . '/includes/model.php';
require_once __DIR__ . '/includes/entries.php';

register_activation_hook( __FILE__, 'fortw_activate' );
register_deactivation_hook( __FILE__, 'fortw_deactivate' );

function fortw_activate() {
	fortw_register_model();
	fortw_install_roles();
	flush_rewrite_rules();
	if ( ! wp_next_scheduled( 'fortw_daily' ) ) {
		wp_schedule_event( strtotime( 'tomorrow 00:05' ), 'daily', 'fortw_daily' );
	}
}

function fortw_deactivate() {
	wp_clear_scheduled_hook( 'fortw_daily' );
	flush_rewrite_rules();
}

// Roles are stored in the database, so re-sync them when the plugin version changes.
add_action(
	'admin_init',
	function () {
		if ( get_option( 'fortw_roles_version' ) !== FORT_WEEKLY_VERSION ) {
			fortw_install_roles();
		}
	}
);
