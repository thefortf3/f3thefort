<?php
/**
 * The Schedule page (the page with slug "schedule"): every workout on the Q sheet for the next two
 * weeks, from GloomSchedule via the stats API: day, time, AO, kind, the Q(s) and the AO's site Qs.
 * Anything written on the page itself (notes, links) shows above it.
 *
 * @package Fort
 */

defined( 'ABSPATH' ) || exit;

// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only filter in the URL
$kind     = isset( $_GET['f'] ) ? sanitize_key( wp_unslash( $_GET['f'] ) ) : '';
$kinds    = array(
	''     => __( 'Everything', 'fort' ),
	'1st'  => __( '1st F · Fitness', 'fort' ),
	'2nd'  => __( '2nd F · Fellowship', 'fort' ),
	'3rd'  => __( '3rd F · Faith', 'fort' ),
);
$kind     = array_key_exists( $kind, $kinds ) ? $kind : '';
$schedule = fort_schedule( 14 );

get_header();
?>
<main id="main" class="fort-entry fort-schedule">
	<div class="fort-wrap">
		<?php while ( have_posts() ) : the_post(); ?>
			<header class="fort-entry__head fort-schedule__head">
				<span class="fort-kicker fort-accent2"><?php esc_html_e( 'In the gloom', 'fort' ); ?></span>
				<h1 class="fort-entry__title"><?php the_title(); ?></h1>
				<p class="fort-entry__dek"><?php esc_html_e( 'Every workout on the Q sheet for the next two weeks. No sign-up and no cost — just show up a few minutes early.', 'fort' ); ?></p>
			</header>
			<?php if ( '' !== trim( get_the_content() ) ) : ?>
				<div class="fort-prose fort-schedule__notes"><?php the_content(); ?></div>
			<?php endif; ?>
		<?php endwhile; ?>

		<nav class="fort-chips" aria-label="<?php esc_attr_e( 'Show', 'fort' ); ?>">
			<?php foreach ( $kinds as $key => $label ) : ?>
				<a class="fort-chip<?php echo $kind === $key ? ' is-current' : ''; ?>" href="<?php echo esc_url( $key ? add_query_arg( 'f', $key, get_permalink() ) : get_permalink() ); ?>"<?php echo $kind === $key ? ' aria-current="page"' : ''; ?>><?php echo esc_html( $label ); ?></a>
			<?php endforeach; ?>
		</nav>

		<?php if ( ! $schedule ) : ?>
			<p class="fort-notice"><?php esc_html_e( 'The Q sheet can’t be reached right now. Check back in a few minutes, or ask in Slack.', 'fort' ); ?></p>
		<?php else : ?>
			<?php fort_render_schedule_page( $schedule, $kind ); ?>
		<?php endif; ?>

		<p class="fort-dim fort-schedule__foot">
			<?php esc_html_e( 'From the Q sheet, updated every few minutes. Things change — weather, holidays — so check Slack if in doubt.', 'fort' ); ?>
			<a class="fort-accent2" href="https://app.gloomschedule.com/"><?php esc_html_e( 'Want to Q? Sign up ↗', 'fort' ); ?></a>
		</p>
	</div>
</main>
<?php
get_footer();
