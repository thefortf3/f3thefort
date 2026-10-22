<?php
/**
 * One backblast (/backblasts/<id>/), from the stats API: the write-up, when and where, the Q(s),
 * and the PAX who posted.
 *
 * @package Fort
 */

defined( 'ABSPATH' ) || exit;

$b = fort_current_backblast();

get_header();
?>
<main id="main" class="fort-entry">
	<div class="fort-wrap fort-wrap--narrow">
		<?php fort_render_backblast_entry( $b ); ?>
	</div>
</main>
<?php
get_footer();
