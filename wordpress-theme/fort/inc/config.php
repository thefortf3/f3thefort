<?php
/**
 * Where the theme gets its data. Events, region info and the submit form come from the Fort
 * Weekly plugin; workouts, backblasts and stats from the Fort Stats plugin when it's active, else
 * from the stats API. Override in wp-config.php:
 *
 *   define( 'FORT_STATS_API', 'https://stats.f3thefort.com' );  // workouts / backblasts / stats (server-side)
 *   define( 'FORT_STATS_URL', 'https://stats.f3thefort.com' );  // public stats site, for links
 *
 * @package Fort
 */

defined( 'ABSPATH' ) || exit;

if ( ! defined( 'FORT_STATS_API' ) ) {
	define( 'FORT_STATS_API', 'https://stats.f3thefort.com' );
}
// The public stats website visitors are linked to. Separate from FORT_STATS_API, which may be an
// internal address only the server can reach.
if ( ! defined( 'FORT_STATS_URL' ) ) {
	define( 'FORT_STATS_URL', function_exists( 'fort_stats_core' ) ? home_url( '/stats/' ) : 'https://stats.f3thefort.com' );
}
// Seconds to cache stats responses (the stats data changes about once a day).
if ( ! defined( 'FORT_STATS_TTL' ) ) {
	define( 'FORT_STATS_TTL', 900 );
}
