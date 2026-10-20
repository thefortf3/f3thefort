<?php
/**
 * Where the theme gets its data. Override any of these in wp-config.php, e.g.
 *
 *   define( 'FORT_NL_API', 'https://submit.f3thefort.com' );   // newsletter app (entries, region info)
 *   define( 'FORT_NL_SECRET', '…' );                            // must match FORT_SHARED_SECRET there
 *   define( 'FORT_STATS_API', 'https://stats.f3thefort.com' );  // workouts / backblasts / stats
 *
 * Without FORT_NL_SECRET the site still renders; only the "Submit an event" form and the
 * newsletter app's cache-flush call are disabled.
 *
 * @package Fort
 */

defined( 'ABSPATH' ) || exit;

if ( ! defined( 'FORT_NL_API' ) ) {
	define( 'FORT_NL_API', 'https://submit.f3thefort.com' );
}
if ( ! defined( 'FORT_NL_SECRET' ) ) {
	define( 'FORT_NL_SECRET', '' );
}
if ( ! defined( 'FORT_STATS_API' ) ) {
	define( 'FORT_STATS_API', 'https://stats.f3thefort.com' );
}
// Seconds to cache newsletter-app responses. Approvals also flush the cache right away.
if ( ! defined( 'FORT_API_TTL' ) ) {
	define( 'FORT_API_TTL', 120 );
}
// Seconds to cache stats responses (the stats data changes about once a day).
if ( ! defined( 'FORT_STATS_TTL' ) ) {
	define( 'FORT_STATS_TTL', 900 );
}
