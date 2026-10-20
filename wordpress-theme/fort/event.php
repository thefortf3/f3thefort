<?php
/**
 * Entry page: /events/<slug>/ — the full version of a newsletter item.
 *
 * @package Fort
 */

defined( 'ABSPATH' ) || exit;

$data = fort_current_entry();
$e    = $data['entry'];
$img  = $e['hero_image'] ?? '';
$next = $e['next_occurrence'] ?? null;

get_header();
?>
<main id="main" class="fort-entry">
	<div class="fort-wrap fort-wrap--narrow">
		<a class="fort-more fort-back" href="<?php echo esc_url( home_url( '/#this-week' ) ); ?>"><?php esc_html_e( '← This week', 'fort' ); ?></a>

		<header class="fort-entry__head">
			<div class="fort-entry__tags">
				<?php foreach ( $e['tags'] as $t ) : $c = sanitize_hex_color( $t['color'] ?? '' ) ?: '#9a9da5'; ?>
					<span class="fort-tag" style="color:<?php echo esc_attr( $c ); ?>;border-color:<?php echo esc_attr( $c ); ?>"><?php echo esc_html( strtoupper( $t['label'] ) ); ?></span>
				<?php endforeach; ?>
				<?php if ( ! empty( $e['is_past'] ) ) : ?><span class="fort-tag fort-tag--muted"><?php esc_html_e( 'PAST EVENT', 'fort' ); ?></span><?php endif; ?>
			</div>
			<h1 class="fort-entry__title"><?php echo esc_html( $e['title'] ); ?></h1>
			<?php if ( ! empty( $e['summary'] ) ) : ?><p class="fort-entry__dek"><?php echo esc_html( $e['summary'] ); ?></p><?php endif; ?>
		</header>

		<?php if ( $img ) : ?>
			<figure class="fort-entry__hero"><img src="<?php echo esc_url( $img ); ?>" alt="<?php echo esc_attr( sprintf( /* translators: %s: entry title */ __( 'Flyer for %s', 'fort' ), $e['title'] ) ); ?>"></figure>
		<?php endif; ?>

		<dl class="fort-facts">
			<dt><?php esc_html_e( 'When', 'fort' ); ?></dt>
			<dd>
				<?php if ( $e['upcoming_dates'] ) : ?>
					<?php foreach ( $e['upcoming_dates'] as $o ) : $p = fort_date_parts( $o['date'] ); ?>
						<span class="fort-facts__date"><?php echo esc_html( $p['long'] ); ?><?php $t = fort_time_label( $o ); echo $t ? ' <span class="fort-mono-dim">' . esc_html( $t ) . '</span>' : ''; ?></span>
					<?php endforeach; ?>
				<?php elseif ( $e['occurrences'] ) : $o = end( $e['occurrences'] ); $p = fort_date_parts( $o['date'] ); ?>
					<span class="fort-facts__date"><?php echo esc_html( $p['long'] ); ?> <span class="fort-mono-dim"><?php esc_html_e( '(past)', 'fort' ); ?></span></span>
				<?php else : ?>
					<?php esc_html_e( 'Ongoing', 'fort' ); ?>
				<?php endif; ?>
			</dd>
			<?php if ( ! empty( $e['location'] ) ) : ?>
				<dt><?php esc_html_e( 'Where', 'fort' ); ?></dt>
				<dd><?php echo esc_html( $e['location'] ); ?> <a class="fort-more" href="<?php echo esc_url( 'https://www.google.com/maps/search/?api=1&query=' . rawurlencode( $e['location'] ) ); ?>"><?php esc_html_e( 'Map ↗', 'fort' ); ?></a></dd>
			<?php endif; ?>
			<?php if ( ! empty( $e['leader'] ) ) : ?>
				<dt><?php esc_html_e( 'Q', 'fort' ); ?></dt>
				<dd><?php echo esc_html( $e['leader'] ); ?></dd>
			<?php endif; ?>
		</dl>

		<div class="fort-actions fort-actions--full">
			<?php if ( ! empty( $e['link'] ) ) : ?>
				<a class="fort-btn" href="<?php echo esc_url( $e['link'] ); ?>"><?php esc_html_e( 'Details / register ↗', 'fort' ); ?></a>
			<?php endif; ?>
			<?php if ( ! empty( $e['preblast_url'] ) ) : ?>
				<a class="fort-btn fort-btn--outline" href="<?php echo esc_url( $e['preblast_url'] ); ?>"><?php esc_html_e( 'Read the pre-blast ↗', 'fort' ); ?></a>
			<?php endif; ?>
		</div>

		<div class="fort-prose">
			<?php echo wp_kses_post( $e['description_html'] ); ?>
		</div>

		<?php if ( ! empty( $e['video_url'] ) ) : ?>
			<div class="fort-video"><?php echo wp_oembed_get( $e['video_url'] ) ?: '<a class="fort-more" href="' . esc_url( $e['video_url'] ) . '">' . esc_html__( 'Watch the video ↗', 'fort' ) . '</a>'; // phpcs:ignore WordPress.Security.EscapeOutput -- oEmbed HTML from WordPress ?></div>
		<?php endif; ?>

		<?php $related_entries = $next && $data['same_day'] ? $data['same_day'] : $data['related']; ?>
		<?php if ( $related_entries ) : ?>
			<section class="fort-section fort-related">
				<header class="fort-section__head fort-section__head--accent2">
					<h2 class="fort-h3">
						<?php
						if ( $next && $data['same_day'] ) {
							$p = fort_date_parts( $next['date'] );
							/* translators: %s: weekday, e.g. "Saturday" */
							echo esc_html( sprintf( __( 'Also on %s', 'fort' ), gmdate( 'l', strtotime( $next['date'] ) ) ) );
						} else {
							esc_html_e( 'You might also like', 'fort' );
						}
						?>
					</h2>
				</header>
				<?php foreach ( $related_entries as $r ) { fort_render_coming_row( $r ); } ?>
				<a class="fort-more" href="<?php echo esc_url( home_url( '/#this-week' ) ); ?>"><?php esc_html_e( 'See the whole week →', 'fort' ); ?></a>
			</section>
		<?php endif; ?>
	</div>
</main>
<?php
get_footer();
