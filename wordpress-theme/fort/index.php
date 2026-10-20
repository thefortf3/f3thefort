<?php
/**
 * Fallback listing: the blog index, categories (AOs), tags, dates and search results.
 *
 * @package Fort
 */

defined( 'ABSPATH' ) || exit;

get_header();
?>
<main id="main" class="fort-wrap fort-archive">
	<header class="fort-section__head fort-section__head--accent2">
		<h1 class="fort-h2">
			<?php
			if ( is_search() ) {
				/* translators: %s: search terms */
				echo esc_html( sprintf( __( 'Search: %s', 'fort' ), get_search_query() ) );
			} elseif ( is_archive() ) {
				echo esc_html( wp_strip_all_tags( get_the_archive_title() ) );
			} else {
				esc_html_e( 'Backblasts', 'fort' );
			}
			?>
		</h1>
		<?php get_search_form(); ?>
	</header>

	<?php if ( is_category() && category_description() ) : ?>
		<div class="fort-prose fort-archive__intro"><?php echo wp_kses_post( category_description() ); ?></div>
	<?php endif; ?>

	<?php if ( have_posts() ) : ?>
		<div class="fort-bb-grid fort-bb-grid--wide">
			<?php
			while ( have_posts() ) {
				the_post();
				fort_render_post_card();
			}
			?>
		</div>
		<div class="fort-pagination">
			<?php the_posts_pagination( array( 'mid_size' => 1, 'prev_text' => '← ' . __( 'Newer', 'fort' ), 'next_text' => __( 'Older', 'fort' ) . ' →' ) ); ?>
		</div>
	<?php else : ?>
		<p class="fort-dim fort-empty"><?php esc_html_e( 'Nothing here yet.', 'fort' ); ?></p>
	<?php endif; ?>
</main>
<?php
get_footer();
