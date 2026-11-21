package com.openmausbot.companion.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp

/** Lucide line icons (ISC). Stroke is black so Compose Icon tint can recolor them. */
internal object VectraIcons {
    val ArrowLeft = stroke("M12 19 L5 12 L12 5", "M19 12 H5")
    val Ellipsis = stroke("M12 12 m0 0", circles = listOf(5f to 12f, 12f to 12f, 19f to 12f))
    val Send = stroke(
        "M14.536 21.686 a0.5 0.5 0 0 0 0.937 -0.024 l6.5 -19 a0.496 0.496 0 0 0 -0.635 -0.635 l-19 6.5 a0.5 0.5 0 0 0 -0.024 0.937 l7.93 3.18 a2 2 0 0 1 1.112 1.11 z",
        "M21.854 2.147 L10.914 13.086",
    )
    val Square = stroke("M5 5 H19 A2 2 0 0 1 21 7 V19 A2 2 0 0 1 19 21 H5 A2 2 0 0 1 3 19 V7 A2 2 0 0 1 5 5 Z")
    val Search = stroke("M21 21 L16.66 16.66", circles = listOf(11f to 11f), radius = 8f)
    val Plus = stroke("M5 12 H19", "M12 5 V19")
    val Close = stroke("M18 6 L6 18", "M6 6 L18 18")
    val Folder = stroke("M3 7 A2 2 0 0 1 5 5 H9 L11 7 H19 A2 2 0 0 1 21 9 V18 A2 2 0 0 1 19 20 H5 A2 2 0 0 1 3 18 Z")
    val Monitor = stroke("M4 3 H20 A2 2 0 0 1 22 5 V15 A2 2 0 0 1 20 17 H4 A2 2 0 0 1 2 15 V5 A2 2 0 0 1 4 3 Z", "M12 17 V21 M8 21 H16")
    val Browser = stroke("M3 5 H21 V19 H3 Z", "M3 9 H21 M6 7 H6 M9 7 H9")
    val Terminal = stroke("M4 17 L9 12 L4 7", "M12 17 H20")
    val ChevronDown = stroke("M6 9 L12 15 L18 9")
    val ChevronRight = stroke("M9 6 L15 12 L9 18")
    val File = stroke("M6 3 H14 L19 8 V21 H6 Z", "M14 3 V8 H19")
}

private fun stroke(vararg data: String, circles: List<Pair<Float, Float>> = emptyList(), radius: Float = 1f): ImageVector {
    val builder = ImageVector.Builder(
        name = "vectra",
        defaultWidth = 24.dp,
        defaultHeight = 24.dp,
        viewportWidth = 24f,
        viewportHeight = 24f,
    )
    data.filter { it.isNotBlank() && !it.contains("m0 0") }.forEach { spec ->
        builder.addPath(
            pathData = PathParser().parsePathString(spec).toNodes(),
            stroke = SolidColor(Color.Black),
            strokeLineWidth = 2f,
            strokeLineCap = StrokeCap.Round,
            strokeLineJoin = StrokeJoin.Round,
        )
    }
    circles.forEach { (cx, cy) ->
        val d = "M${cx + radius} $cy A$radius $radius 0 1 0 ${cx - radius} $cy A$radius $radius 0 1 0 ${cx + radius} $cy"
        builder.addPath(
            pathData = PathParser().parsePathString(d).toNodes(),
            stroke = SolidColor(Color.Black),
            strokeLineWidth = 2f,
            strokeLineCap = StrokeCap.Round,
            strokeLineJoin = StrokeJoin.Round,
        )
    }
    return builder.build()
}
