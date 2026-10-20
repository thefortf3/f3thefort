<?php
/**
 * One backblast (/backblasts/<id>/), from the stats API: the write-up, when and where, the Q(s),
 * and the PAX who posted.
 *
 * @package Fort
 */

defined( 'ABSPATH' ) || exit;

$b = fort_current_backblast();
$p = fort_date_parts( $b['date'] );

get_header();
?>
<main id="main" class="fort-entry">
	<div class="fort-wrap fort-wrap--narrow">
		<a class="fort-more fort-back" href="<?php echo esc_url( fort_backblasts_url() ); ?>"><?php esc_html_e( '← All backblasts', 'fort' ); ?></a>
		<header class="fort-entry__head">
			<span class="fort-kicker fort-accent2"><?php echo esc_html( strtoupper( $b['ao'] . ' · ' . trim( $p['dow'] . ' ' . $p['mon'] . ' ' . $p['day'] ) ) ); ?></span>
			<h1 class="fort-entry__title"><?php echo esc_html( fort_backblast_title( $b ) ); ?></h1>
		</header>

		<dl class="fort-facts">
			<dt><?php esc_html_e( 'When', 'fort' ); ?></dt>
			<dd><?php echo esc_html( $p['long'] ); ?><?php echo ! empty( $b['start_time'] ) ? ' <span class="fort-mono-dim">' . esc_html( $b['start_time'] ) . '</span>' : ''; ?></dd>
			<dt><?php esc_html_e( 'AO', 'fort' ); ?></dt>
			<dd>
				<a href="<?php echo esc_url( fort_backblasts_url( array( 'ao' => $b['ao'] ) ) ); ?>"><?php echo esc_html( $b['ao'] ); ?></a>
				<?php if ( ! empty( $b['location'] ) && $b['location'] !== $b['ao'] ) : ?><span class="fort-mono-dim">· <?php echo esc_html( $b['location'] ); ?></span><?php endif; ?>
			</dd>
			<?php if ( $b['qs'] ) : ?>
				<dt><?php esc_html_e( 'Q', 'fort' ); ?></dt>
				<dd><?php echo esc_html( implode( ' & ', $b['qs'] ) ); ?><?php echo $b['coqs'] ? ' <span class="fort-mono-dim">· ' . esc_html( sprintf( /* translators: %s: names */ __( 'Co-Q: %s', 'fort' ), implode( ', ', $b['coqs'] ) ) ) . '</span>' : ''; ?></dd>
			<?php endif; ?>
			<dt><?php esc_html_e( 'PAX', 'fort' ); ?></dt>
			<dd>
				<?php echo esc_html( (int) $b['pax_count'] ); ?><?php echo $b['fng_count'] ? ' <span class="fort-amber">' . esc_html( sprintf( '+%d FNG', (int) $b['fng_count'] ) ) . '</span>' : ''; ?>
				<?php if ( $b['pax'] ) : ?><span class="fort-bb-pax"><?php echo esc_html( implode( ', ', $b['pax'] ) ); ?></span><?php endif; ?>
			</dd>
		</dl>

		<div class="fort-prose fort-bb-body">
			<?php if ( $b['paragraphs'] ) : ?>
				<?php foreach ( $b['paragraphs'] as $para ) : ?>
					<p><?php echo nl2br( esc_html( $para ) ); ?></p>
				<?php endforeach; ?>
			<?php else : ?>
				<p class="fort-dim"><?php esc_html_e( 'No write-up for this one.', 'fort' ); ?></p>
			<?php endif; ?>
		</div>

		<p class="fort-actions">
			<?php /* translators: %s: AO name */ ?>
			<a class="fort-btn fort-btn--outline" href="<?php echo esc_url( fort_backblasts_url( array( 'ao' => $b['ao'] ) ) ); ?>"><?php echo esc_html( sprintf( __( 'More from %s', 'fort' ), $b['ao'] ) ); ?></a>
		</p>
	</div>
</main>
<?php
get_footer();
