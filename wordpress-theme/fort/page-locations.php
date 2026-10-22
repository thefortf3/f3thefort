<?php
/**
 * Find a workout (the page with slug "locations"): every AO on a map, with the list beside it.
 * See inc/locations.php. The page's own content isn't shown: on the live site it holds the old
 * F3 Nation map embed.
 *
 * @package Fort
 */

defined( 'ABSPATH' ) || exit;

$map   = fort_map();
$today = function_exists( 'fstats_region_today' ) ? fstats_region_today() : wp_date( 'Y-m-d' );
$days  = array( 1 => __( 'Mon', 'fort' ), 2 => __( 'Tue', 'fort' ), 3 => __( 'Wed', 'fort' ), 4 => __( 'Thu', 'fort' ), 5 => __( 'Fri', 'fort' ), 6 => __( 'Sat', 'fort' ), 7 => __( 'Sun', 'fort' ) );
// Kinds: the short label, and the rest (hidden on phones).
$kinds = array(
	''    => array( __( 'Everything', 'fort' ), '' ),
	'1st' => array( __( '1st F', 'fort' ), __( ' · Fitness', 'fort' ) ),
	'2nd' => array( __( '2nd F', 'fort' ), __( ' · Fellowship', 'fort' ) ),
	'3rd' => array( __( '3rd F', 'fort' ), __( ' · Faith', 'fort' ) ),
);

get_header();
?>
<main id="main" class="fort-entry fort-loc">
	<div class="fort-wrap">
		<?php while ( have_posts() ) : the_post(); ?>
			<header class="fort-entry__head fort-loc__head">
				<span class="fort-kicker"><?php esc_html_e( 'Fort Mill · Tega Cay', 'fort' ); ?></span>
				<h1 class="fort-entry__title"><?php the_title(); ?></h1>
				<p class="fort-entry__dek"><?php esc_html_e( 'Every AO, where it meets and when. Free, rain or shine — pick one, get there a few minutes early and tell the Q you’re new.', 'fort' ); ?></p>
			</header>
		<?php endwhile; ?>

		<?php if ( ! $map ) : ?>
			<p class="fort-notice"><?php esc_html_e( 'The AO list can’t be reached right now. Check back in a few minutes, or see the schedule.', 'fort' ); ?> <a href="<?php echo esc_url( fort_page_url( 'schedule', home_url( '/#workouts' ) ) ); ?>"><?php esc_html_e( 'Schedule →', 'fort' ); ?></a></p>
		<?php else : ?>
			<div class="fort-loc__bar" hidden>
				<div class="fort-st-seg" role="group" aria-label="<?php esc_attr_e( 'Day', 'fort' ); ?>">
					<button type="button" class="fort-st-seg__opt is-current" data-day="" aria-pressed="true"><?php esc_html_e( 'Any day', 'fort' ); ?></button>
					<?php foreach ( $days as $n => $label ) : ?>
						<button type="button" class="fort-st-seg__opt" data-day="<?php echo esc_attr( (string) $n ); ?>" aria-pressed="false"><?php echo esc_html( $label ); ?></button>
					<?php endforeach; ?>
				</div>
				<div class="fort-st-seg" role="group" aria-label="<?php esc_attr_e( 'Kind', 'fort' ); ?>">
					<?php foreach ( $kinds as $key => $label ) : ?>
						<button type="button" class="fort-st-seg__opt<?php echo '' === $key ? ' is-current' : ''; ?>" data-kind="<?php echo esc_attr( $key ); ?>" aria-pressed="<?php echo '' === $key ? 'true' : 'false'; ?>"><?php echo esc_html( $label[0] ); ?><?php if ( $label[1] ) : ?><span class="fort-loc__long"><?php echo esc_html( $label[1] ); ?></span><?php endif; ?></button>
					<?php endforeach; ?>
				</div>
				<button type="button" class="fort-loc__near" aria-pressed="false"><span class="fort-loc__near-dot" aria-hidden="true"></span><?php esc_html_e( 'Closest to me', 'fort' ); ?></button>
			</div>

			<div class="fort-loc__body">
				<div class="fort-loc__mapcol">
					<div id="fort-map" class="fort-loc__map" role="region" aria-label="<?php esc_attr_e( 'Map of AOs', 'fort' ); ?>">
						<p class="fort-loc__nomap"><?php esc_html_e( 'The map needs JavaScript. Every AO is listed here too.', 'fort' ); ?></p>
					</div>
					<p class="fort-loc__status" role="status" aria-live="polite"></p>
				</div>

				<div class="fort-loc__list">
					<?php foreach ( $map['sites'] as $s ) : ?>
						<article class="fort-loc__site" id="site-<?php echo esc_attr( $s['id'] ); ?>" data-site="<?php echo esc_attr( $s['id'] ); ?>">
							<header class="fort-loc__site-head">
								<h2 class="fort-loc__venue"><button type="button" class="fort-loc__show" data-site="<?php echo esc_attr( $s['id'] ); ?>"><?php echo esc_html( $s['venue'] ?? $s['aos'][0]['name'] ); ?></button></h2>
								<span class="fort-loc__dist" aria-hidden="true"></span>
								<a class="fort-loc__dir" href="<?php echo esc_url( fort_loc_directions_url( $s['lat'], $s['lng'] ) ); ?>" target="_blank" rel="noopener"><?php esc_html_e( 'Directions ↗', 'fort' ); ?></a>
							</header>
							<ul class="fort-loc__aos">
								<?php foreach ( $s['aos'] as $a ) { fort_render_loc_ao( $a, $today ); } ?>
							</ul>
						</article>
					<?php endforeach; ?>

					<?php if ( $map['unplaced'] ) : ?>
						<article class="fort-loc__site fort-loc__site--unplaced">
							<header class="fort-loc__site-head">
								<h2 class="fort-loc__venue"><?php esc_html_e( 'Not on the map yet', 'fort' ); ?></h2>
							</header>
							<ul class="fort-loc__aos">
								<?php foreach ( $map['unplaced'] as $a ) { fort_render_loc_ao( $a, $today, true ); } ?>
							</ul>
						</article>
					<?php endif; ?>

					<p class="fort-loc__empty fort-dim" hidden><?php esc_html_e( 'Nothing meets then. Try another day.', 'fort' ); ?></p>
				</div>
			</div>

			<script type="application/json" id="fort-map-data"><?php echo fort_loc_map_json( $map ); // phpcs:ignore WordPress.Security.EscapeOutput -- JSON, escaped by wp_json_encode ?></script>
		<?php endif; ?>

		<p class="fort-dim fort-loc__foot">
			<?php esc_html_e( 'From the Q sheet (GloomSchedule), updated every hour. Weather and holidays change things, so check the Fort’s Slack if in doubt.', 'fort' ); ?>
			<a class="fort-accent2" href="<?php echo esc_url( fort_page_url( 'schedule', home_url( '/#workouts' ) ) ); ?>"><?php esc_html_e( 'This week’s schedule →', 'fort' ); ?></a>
		</p>
	</div>
</main>
<?php
get_footer();
