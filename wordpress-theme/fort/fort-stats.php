<?php
/**
 * The stats pages (the Fort Stats plugin's /stats/… addresses): leaderboard, AOs, one AO, one
 * PAX, trends, streaks, FNGs and the FNG challenge board. Rendered here, in the theme's own
 * style, from the plugin's data (inc/stats.php).
 *
 * @package Fort
 */

defined( 'ABSPATH' ) || exit;

$fort_view = fort_stats_view();
$fort_core = fort_stats_core();
$fort_page = fort_st_page( $fort_view, $fort_core );
if ( ! empty( $fort_page['missing'] ) ) {
	status_header( 404 );
}

get_header();
?>
<main id="main" class="fort-entry fort-st fort-st--<?php echo esc_attr( $fort_view ); ?>">
	<div class="fort-wrap">
		<?php if ( ! empty( $fort_page['back'] ) ) : ?>
			<a class="fort-more fort-back" href="<?php echo esc_url( $fort_page['back'][0] ); ?>"><?php echo esc_html( '← ' . $fort_page['back'][1] ); ?></a>
		<?php endif; ?>
		<header class="fort-entry__head fort-st__head">
			<span class="fort-kicker fort-accent2"><?php echo esc_html( $fort_page['kicker'] ); ?></span>
			<h1 class="fort-entry__title"><?php echo esc_html( $fort_page['title'] ); ?></h1>
			<?php if ( ! empty( $fort_page['dek'] ) ) : ?>
				<p class="fort-entry__dek"><?php echo esc_html( $fort_page['dek'] ); ?></p>
			<?php endif; ?>
		</header>

		<?php fort_st_tabs( $fort_view, $fort_core ); ?>

		<?php
		if ( ! empty( $fort_page['missing'] ) ) {
			echo '<p class="fort-dim fort-empty">' . esc_html__( 'We couldn’t find that one. It may not have posted in the data the stats come from.', 'fort' ) . '</p>';
		} elseif ( ! $fort_core && 'fng-challenge' !== $fort_view ) {
			echo '<p class="fort-notice">' . esc_html__( 'Stats can’t be loaded right now. Check back in a few minutes.', 'fort' ) . '</p>';
		} else {
			call_user_func( $fort_page['render'], $fort_core );
		}
		?>
	</div>
</main>
<?php
get_footer();
