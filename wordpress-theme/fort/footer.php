<?php
/**
 * Site footer: submit prompt, shared leadership, links.
 *
 * @package Fort
 */

defined( 'ABSPATH' ) || exit;

$region = fort_region();
?>
<footer class="fort-footer">
	<div class="fort-wrap fort-footer__cols">
		<section class="fort-footer__col">
			<h2 class="fort-h3"><?php esc_html_e( 'Got something for the PAX?', 'fort' ); ?></h2>
			<p class="fort-dim"><?php esc_html_e( 'Post it here and, once approved, it lands on this site and in the next issue of The Fort Weekly.', 'fort' ); ?></p>
			<a class="fort-more" href="<?php echo esc_url( fort_submit_url() ); ?>"><?php esc_html_e( 'Submit an event →', 'fort' ); ?></a>
		</section>
		<?php if ( ! empty( $region['slt'] ) ) : ?>
			<section class="fort-footer__col fort-footer__col--wide">
				<h2 class="fort-h3"><?php esc_html_e( 'Shared leadership', 'fort' ); ?></h2>
				<p class="fort-dim fort-footer__slt">
					<?php
					echo esc_html(
						implode(
							' · ',
							array_map( fn( $s ) => $s['name'] . ', ' . $s['role'], $region['slt'] )
						)
					);
					?>
				</p>
			</section>
		<?php endif; ?>
		<?php if ( ! empty( $region['links'] ) || has_nav_menu( 'footer' ) ) : ?>
			<section class="fort-footer__col">
				<h2 class="fort-h3"><?php esc_html_e( 'Links', 'fort' ); ?></h2>
				<?php if ( has_nav_menu( 'footer' ) ) : ?>
					<?php wp_nav_menu( array( 'theme_location' => 'footer', 'container' => false, 'menu_class' => 'fort-footer__links', 'depth' => 1 ) ); ?>
				<?php else : ?>
					<ul class="fort-footer__links">
						<?php foreach ( $region['links'] as $l ) : ?>
							<li><a href="<?php echo esc_url( $l['url'] ); ?>"><?php echo esc_html( $l['label'] ); ?> ↗</a></li>
						<?php endforeach; ?>
					</ul>
				<?php endif; ?>
			</section>
		<?php endif; ?>
	</div>
	<div class="fort-wrap fort-footer__base">
		<span>© <?php echo esc_html( gmdate( 'Y' ) ); ?> THE FORT F3 · FORT MILL · TEGA CAY</span>
		<span><a href="mailto:thefort@f3nation.com">EMAIL</a> <a href="https://www.instagram.com/f3_thefort/">INSTAGRAM</a></span>
	</div>
</footer>
<?php wp_footer(); ?>
</body>
</html>
