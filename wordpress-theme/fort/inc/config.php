<?php
/**
 * Site-wide settings. Events, region info and the submit form come from the Fort Weekly plugin;
 * workouts, backblasts and stats from the Fort Stats plugin, whose pages are at /stats/.
 *
 * @package Fort
 */

defined( 'ABSPATH' ) || exit;

// The stats pages visitors are linked to (the Fort Stats plugin's).
if ( ! defined( 'FORT_STATS_URL' ) ) {
	define( 'FORT_STATS_URL', home_url( '/stats/' ) );
}
