<?php
/**
 * Site header.
 *
 * @package Fort
 */

defined( 'ABSPATH' ) || exit;
?><!doctype html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<?php wp_body_open(); ?>
<a class="fort-skip" href="#main"><?php esc_html_e( 'Skip to content', 'fort' ); ?></a>
<header class="fort-header">
	<div class="fort-wrap fort-header__inner">
		<a class="fort-brand" href="<?php echo esc_url( home_url( '/' ) ); ?>">F3 <span class="fort-amber">THE FORT</span></a>
		<nav class="fort-nav" aria-label="<?php esc_attr_e( 'Main', 'fort' ); ?>">
			<?php
			if ( has_nav_menu( 'primary' ) ) {
				wp_nav_menu(
					array(
						'theme_location' => 'primary',
						'container'      => false,
						'menu_class'     => 'fort-nav__list',
						'depth'          => 1,
					)
				);
			} else {
				?>
				<ul class="fort-nav__list">
					<li><a href="<?php echo esc_url( home_url( '/#this-week' ) ); ?>"><?php esc_html_e( 'This week', 'fort' ); ?></a></li>
					<li><a href="<?php echo esc_url( home_url( '/#coming-up' ) ); ?>"><?php esc_html_e( 'Calendar', 'fort' ); ?></a></li>
					<li><a href="<?php echo esc_url( fort_page_url( 'schedule', home_url( '/#workouts' ) ) ); ?>"><?php esc_html_e( 'Schedule', 'fort' ); ?></a></li>
					<li><a href="<?php echo esc_url( fort_backblasts_url() ); ?>"><?php esc_html_e( 'Backblasts', 'fort' ); ?></a></li>
					<li><a href="<?php echo esc_url( FORT_STATS_URL ); ?>"<?php echo function_exists( 'fort_stats_is_dashboard' ) && fort_stats_is_dashboard() ? ' aria-current="page"' : ''; ?>><?php echo esc_html( __( 'Stats', 'fort' ) . fort_stats_link_arrow() ); ?></a></li>
				</ul>
				<?php
			}
			?>
			<a class="fort-btn fort-btn--outline" href="<?php echo esc_url( fort_submit_url() ); ?>"><?php esc_html_e( 'Submit an event', 'fort' ); ?></a>
		</nav>
	</div>
</header>
