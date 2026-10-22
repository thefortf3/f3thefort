<?php
/**
 * /stats/ — the Fort Stats plugin's dashboard (leaderboards, AOs, trends, streaks, FNGs), laid
 * out like the theme's other pages.
 *
 * @package Fort
 */

defined( 'ABSPATH' ) || exit;

get_header();
?>
<main id="main" class="fort-entry fort-stats">
	<div class="fort-wrap">
		<header class="fort-entry__head">
			<span class="fort-kicker fort-accent2"><?php esc_html_e( 'By the numbers', 'fort' ); ?></span>
			<h1 class="fort-entry__title"><?php esc_html_e( 'Stats', 'fort' ); ?></h1>
			<p class="fort-entry__dek"><?php esc_html_e( 'Every post, Q and streak in The Fort, from the backblasts. Tap a name or an AO for more.', 'fort' ); ?></p>
		</header>
		<?php
		if ( function_exists( 'fort_stats_dashboard' ) ) {
			fort_stats_dashboard();
		}
		?>
	</div>
</main>
<?php
get_footer();
