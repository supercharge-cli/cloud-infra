#ifndef DESKTOP_INTEGRATION_H_
#define DESKTOP_INTEGRATION_H_

#include <flutter_linux/flutter_linux.h>
#include <gtk/gtk.h>

void desktop_integration_attach(GtkWindow* window, FlView* view, GtkOverlay* overlay);

#endif
