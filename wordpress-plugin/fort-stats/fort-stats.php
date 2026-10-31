<?php
/**
 * Plugin Name:       Fort Stats
 * Plugin URI:        https://f3thefort.com
 * Description:       The Fort's workout stats (leaderboards, AOs, streaks, FNGs), backblasts and Q schedule, inside WordPress. Reads the stats Supabase project over HTTPS; replaces the separate stats.f3thefort.com server.
 * Version:           0.1.1
 * Requires at least: 6.0
 * Requires PHP:      8.3
 * Author:            F3 The Fort
 * License:           GPL-2.0-or-later
 * Text Domain:       fort-stats
 *
 * @package FortStats
 */

defined( 'ABSPATH' ) || exit;

define( 'FORT_STATS_VERSION', '0.1.1' );
define( 'FORT_STATS_FILE', __FILE__ );
define( 'FORT_STATS_DIR', __DIR__ );

foreach ( glob( __DIR__ . '/includes/pure/*.php' ) as $fstats_file ) {
	require_once $fstats_file;
}
require_once __DIR__ . '/includes/rest-source.php';
require_once __DIR__ . '/includes/sources.php';
require_once __DIR__ . '/includes/api.php';
require_once __DIR__ . '/includes/refresh.php';
require_once __DIR__ . '/includes/routes.php';
require_once __DIR__ . '/includes/pages.php';
if ( is_admin() ) {
	require_once __DIR__ . '/includes/admin.php';
}

register_activation_hook( __FILE__, 'fstats_activate' );
register_deactivation_hook( __FILE__, 'fstats_deactivate' );

function fstats_activate() {
	fstats_register_pages();
	flush_rewrite_rules();
	wp_schedule_single_event( time(), 'fstats_refresh' ); // Fetch everything right away.
}

function fstats_deactivate() {
	fstats_unschedule();
	flush_rewrite_rules();
}
