<?php
/**
 * Regular pages (Mission, Schedule, Locations, …).
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
			?>
			<article <?php post_class(); ?>>
				<header class="fort-entry__head"><h1 class="fort-entry__title"><?php the_title(); ?></h1></header>
				<div class="fort-prose"><?php the_content(); ?></div>
			</article>
		<?php endwhile; ?>
	</div>
</main>
<?php
get_footer();
