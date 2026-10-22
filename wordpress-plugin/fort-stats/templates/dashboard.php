<?php
/**
 * /stats/ for themes without their own fort-stats.php: the theme's header and footer around the
 * dashboard.
 *
 * @package FortStats
 */

defined( 'ABSPATH' ) || exit;

get_header();
?>
<main id="main" class="fort-stats-main" style="max-width: 1100px; margin: 0 auto; padding: 24px 16px 48px;">
	<h1><?php esc_html_e( 'Stats', 'fort-stats' ); ?></h1>
	<?php fort_stats_dashboard(); ?>
</main>
<?php
get_footer();
