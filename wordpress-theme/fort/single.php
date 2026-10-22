<?php
/**
 * A single post — usually a backblast or pre-blast.
 *
 * @package Fort
 */

defined( 'ABSPATH' ) || exit;

get_header();
?>
<main id="main" class="fort-entry">
	<div class="fort-wrap fort-wrap--narrow">
		<?php
		while ( have_posts() ) :
			the_post();
			$bb = fort_post_bb();
			if ( $bb ) :
				?>
				<article <?php post_class(); ?>>
					<?php fort_render_backblast_entry( $bb + array( 'hero_html' => has_post_thumbnail() ? get_the_post_thumbnail( null, 'large' ) : '' ) ); ?>
				</article>
				<?php
			else :
				$cats = get_the_category();
				?>
			<article <?php post_class(); ?>>
				<header class="fort-entry__head">
					<div class="fort-entry__tags">
						<?php foreach ( $cats as $c ) : ?>
							<a class="fort-tag fort-accent2" href="<?php echo esc_url( get_category_link( $c ) ); ?>"><?php echo esc_html( strtoupper( $c->name ) ); ?></a>
						<?php endforeach; ?>
					</div>
					<h1 class="fort-entry__title"><?php the_title(); ?></h1>
					<p class="fort-mono-dim"><?php echo esc_html( get_the_date() ); ?></p>
				</header>
				<?php if ( has_post_thumbnail() ) : ?>
					<figure class="fort-entry__hero"><?php the_post_thumbnail( 'large' ); ?></figure>
				<?php endif; ?>
				<div class="fort-prose">
					<?php the_content(); ?>
				</div>
			</article>
			<?php endif; ?>

			<nav class="fort-post-nav" aria-label="<?php esc_attr_e( 'More posts', 'fort' ); ?>">
				<span><?php previous_post_link( '%link', '← %title', true ); ?></span>
				<span><?php next_post_link( '%link', '%title →', true ); ?></span>
			</nav>

			<?php
			$ao_cat = fort_post_ao();
			if ( $ao_cat ) :
				$more_posts = new WP_Query( array( 'cat' => $ao_cat->term_id, 'posts_per_page' => 4, 'post__not_in' => array( get_the_ID() ), 'ignore_sticky_posts' => true ) );
				if ( $more_posts->have_posts() ) :
					?>
					<section class="fort-section fort-related">
						<header class="fort-section__head fort-section__head--accent2">
							<?php /* translators: %s: AO name */ ?>
							<h2 class="fort-h3"><?php echo esc_html( sprintf( __( 'More from %s', 'fort' ), $ao_cat->name ) ); ?></h2>
						</header>
						<div class="fort-bb-grid">
							<?php
							while ( $more_posts->have_posts() ) {
								$more_posts->the_post();
								fort_render_post_card();
							}
							wp_reset_postdata();
							?>
						</div>
					</section>
					<?php
				endif;
			endif;
		endwhile;
		?>
	</div>
</main>
<?php
get_footer();
