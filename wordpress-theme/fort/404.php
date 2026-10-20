<?php
/**
 * Not found (also used for unknown /events/<slug>/ pages).
 *
 * @package Fort
 */

defined( 'ABSPATH' ) || exit;

get_header();
?>
<main id="main" class="fort-wrap fort-wrap--narrow fort-entry">
	<header class="fort-entry__head">
		<span class="fort-label fort-accent2">404</span>
		<h1 class="fort-entry__title"><?php esc_html_e( 'We couldn’t find that page', 'fort' ); ?></h1>
		<p class="fort-entry__dek"><?php esc_html_e( 'If it was an event, it may have been taken down or renamed.', 'fort' ); ?></p>
	</header>
	<div class="fort-actions">
		<a class="fort-btn" href="<?php echo esc_url( home_url( '/#this-week' ) ); ?>"><?php esc_html_e( 'See this week', 'fort' ); ?></a>
		<a class="fort-more" href="<?php echo esc_url( fort_submit_url() ); ?>"><?php esc_html_e( 'Submit an event →', 'fort' ); ?></a>
	</div>
	<?php get_search_form(); ?>
</main>
<?php
get_footer();
