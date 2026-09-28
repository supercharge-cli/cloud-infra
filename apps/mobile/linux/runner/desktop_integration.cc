#include "desktop_integration.h"

#include <webkit2/webkit2.h>

#include <cstring>
#include <cmath>

namespace {
struct DesktopState;

struct InlineSurface {
  DesktopState* owner;
  GtkWidget* view;
  gchar* id;
  gchar* locked_url;
  bool viewer;
};

struct DesktopState {
  GtkWindow* window;
  GtkOverlay* overlay;
  FlView* flutter_view;
  GHashTable* inline_surfaces = nullptr;
  gchar* visible_surface = nullptr;
  GdkRectangle inline_bounds = {0, 0, 0, 0};
  GtkWidget* checkout = nullptr;
  FlMethodCall* pending_checkout = nullptr;
  FlMethodChannel* channel = nullptr;
  int width = 1280;
  int height = 800;
  bool maximized = false;
};

gboolean position_inline_browser(GtkOverlay*, GtkWidget* child, GdkRectangle* allocation, gpointer data) {
  auto* state = static_cast<DesktopState*>(data);
  InlineSurface* surface = state->visible_surface ?
    static_cast<InlineSurface*>(g_hash_table_lookup(state->inline_surfaces, state->visible_surface)) : nullptr;
  if (!surface || child != surface->view) return FALSE;
  *allocation = state->inline_bounds;
  return TRUE;
}

InlineSurface* lookup_inline_surface(DesktopState* state, const gchar* id) {
  return id ? static_cast<InlineSurface*>(g_hash_table_lookup(state->inline_surfaces, id)) : nullptr;
}

void show_inline_surface(DesktopState* state, const gchar* id) {
  GHashTableIter iter;
  gpointer value;
  g_hash_table_iter_init(&iter, state->inline_surfaces);
  while (g_hash_table_iter_next(&iter, nullptr, &value)) {
    gtk_widget_hide(static_cast<InlineSurface*>(value)->view);
  }
  g_free(state->visible_surface);
  state->visible_surface = id ? g_strdup(id) : nullptr;
  InlineSurface* surface = lookup_inline_surface(state, id);
  if (surface && state->inline_bounds.width > 0 && state->inline_bounds.height > 0) gtk_widget_show(surface->view);
  else gtk_widget_grab_focus(GTK_WIDGET(state->flutter_view));
  gtk_widget_queue_resize(GTK_WIDGET(state->overlay));
}

FlValue* value_field(FlValue* args, const char* name, FlValueType type) {
  if (!args || fl_value_get_type(args) != FL_VALUE_TYPE_MAP) return nullptr;
  FlValue* field = fl_value_lookup_string(args, name);
  return field && fl_value_get_type(field) == type ? field : nullptr;
}

const gchar* string_field(FlValue* args, const char* name) {
  FlValue* field = value_field(args, name, FL_VALUE_TYPE_STRING);
  return field ? fl_value_get_string(field) : nullptr;
}

bool allowed_url(const gchar* url, bool viewer) {
  if (!url) return false;
  g_autoptr(GUri) uri = g_uri_parse(url, G_URI_FLAGS_NONE, nullptr);
  if (!uri || !g_uri_get_host(uri) || g_uri_get_userinfo(uri)) return false;
  const gchar* fragment = g_uri_get_fragment(uri);
  if (fragment && std::strlen(fragment) > 4096) return false;
  const gchar* scheme = g_uri_get_scheme(uri);
  if (!scheme || (g_strcmp0(scheme, "http") != 0 && g_strcmp0(scheme, "https") != 0)) return false;
  if (!viewer) return true;
  return g_strcmp0(scheme, "http") == 0 && g_strcmp0(g_uri_get_host(uri), "127.0.0.1") == 0 &&
    g_uri_get_port(uri) > 0 && g_str_has_prefix(g_uri_get_path(uri), "/");
}

gboolean inline_policy(WebKitWebView* view, WebKitPolicyDecision* decision,
                       WebKitPolicyDecisionType type, gpointer data) {
  auto* surface = static_cast<InlineSurface*>(data);
  if (type != WEBKIT_POLICY_DECISION_TYPE_NAVIGATION_ACTION &&
      type != WEBKIT_POLICY_DECISION_TYPE_NEW_WINDOW_ACTION) return FALSE;
  auto* action = webkit_navigation_policy_decision_get_navigation_action(WEBKIT_NAVIGATION_POLICY_DECISION(decision));
  const gchar* url = webkit_uri_request_get_uri(webkit_navigation_action_get_request(action));
  bool permitted = allowed_url(url, surface->viewer);
  if (permitted && surface->viewer) {
    g_autoptr(GUri) expected = g_uri_parse(surface->locked_url, G_URI_FLAGS_NONE, nullptr);
    g_autoptr(GUri) incoming = g_uri_parse(url, G_URI_FLAGS_NONE, nullptr);
    permitted = expected && incoming &&
      g_uri_get_port(expected) == g_uri_get_port(incoming) &&
      g_str_has_prefix(g_uri_get_path(incoming), g_uri_get_path(expected));
  }
  if (!permitted) {
    webkit_policy_decision_ignore(decision);
    return TRUE;
  }
  if (type == WEBKIT_POLICY_DECISION_TYPE_NEW_WINDOW_ACTION) {
    webkit_web_view_load_uri(view, url);
    webkit_policy_decision_ignore(decision);
    return TRUE;
  }
  return FALSE;
}

void destroy_inline_surface(gpointer data) {
  auto* surface = static_cast<InlineSurface*>(data);
  gtk_widget_destroy(surface->view);
  g_free(surface->id);
  g_free(surface->locked_url);
  delete surface;
}

InlineSurface* create_inline_surface(DesktopState* state, const gchar* id, bool viewer) {
  auto* surface = new InlineSurface{state, webkit_web_view_new(), g_strdup(id), nullptr, viewer};
  g_signal_connect(surface->view, "decide-policy", G_CALLBACK(inline_policy), surface);
  gtk_overlay_add_overlay(state->overlay, surface->view);
  gtk_overlay_set_overlay_pass_through(state->overlay, surface->view, FALSE);
  gtk_widget_hide(surface->view);
  g_hash_table_insert(state->inline_surfaces, g_strdup(id), surface);
  return surface;
}

void respond(FlMethodCall* call, FlValue* value = nullptr) {
  fl_method_call_respond_success(call, value, nullptr);
}

void checkout_message(WebKitUserContentManager*, WebKitJavascriptResult* message, gpointer data) {
  auto* state = static_cast<DesktopState*>(data);
  if (!state->pending_checkout) return;
  JSCValue* value = webkit_javascript_result_get_js_value(message);
  g_autofree gchar* json = jsc_value_to_json(value, 0);
  if (!json) return;
  g_autoptr(FlJsonMessageCodec) codec = fl_json_message_codec_new();
  g_autoptr(GBytes) bytes = g_bytes_new(json, strlen(json));
  g_autoptr(FlValue) result = fl_message_codec_decode_message(FL_MESSAGE_CODEC(codec), bytes, nullptr);
  if (!result || fl_value_get_type(result) != FL_VALUE_TYPE_MAP) return;
  respond(state->pending_checkout, result);
  g_clear_object(&state->pending_checkout);
  if (state->checkout) gtk_widget_destroy(state->checkout);
}

void open_checkout(DesktopState* state, FlMethodCall* call, FlValue* args) {
  if (state->pending_checkout) {
    fl_method_call_respond_error(call, "busy", "Checkout is already open.", nullptr, nullptr);
    return;
  }
  g_autoptr(FlJsonMessageCodec) codec = fl_json_message_codec_new();
  g_autoptr(GBytes) bytes = fl_message_codec_encode_message(FL_MESSAGE_CODEC(codec), args, nullptr);
  gsize length;
  const char* raw = static_cast<const char*>(g_bytes_get_data(bytes, &length));
  // Base64 keeps all payment option strings out of the HTML/script grammar.
  g_autofree gchar* encoded = g_base64_encode(reinterpret_cast<const guchar*>(raw), length);
  g_autofree gchar* html = g_strdup_printf(
    "<!doctype html><html><head><meta name='viewport' content='width=device-width, initial-scale=1'>"
    "<title>Secure checkout</title></head><body style='background:#101114;color:white;font:16px sans-serif'>"
    "<p id='status'>Opening secure checkout…</p><script src='https://checkout.razorpay.com/v1/checkout.js'></script>"
    "<script>try{const options=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob('%s'),c=>c.charCodeAt(0))));"
    "const send=v=>window.webkit.messageHandlers.checkout.postMessage(v);"
    "options.handler=r=>send(r);options.modal={ondismiss:()=>send({cancelled:true})};"
    "const checkout=new Razorpay(options);checkout.on('payment.failed',r=>send({error:r.error.description||'Payment failed'}));"
    "checkout.open();}catch(e){document.getElementById('status').textContent='Could not open checkout. Close and try again.'}"
    "</script></body></html>", encoded);
  GtkWidget* window = gtk_application_window_new(gtk_window_get_application(state->window));
  state->checkout = window;
  state->pending_checkout = FL_METHOD_CALL(g_object_ref(call));
  gtk_window_set_transient_for(GTK_WINDOW(window), state->window);
  gtk_window_set_modal(GTK_WINDOW(window), TRUE);
  gtk_window_set_default_size(GTK_WINDOW(window), 720, 780);
  gtk_window_set_title(GTK_WINDOW(window), "Vectra Cloud — Secure checkout");
  GtkWidget* header = gtk_header_bar_new();
  gtk_header_bar_set_title(GTK_HEADER_BAR(header), "Secure checkout");
  gtk_header_bar_set_show_close_button(GTK_HEADER_BAR(header), TRUE);
  gtk_window_set_titlebar(GTK_WINDOW(window), header);
  g_autoptr(WebKitUserContentManager) manager = webkit_user_content_manager_new();
  webkit_user_content_manager_register_script_message_handler(manager, "checkout");
  g_signal_connect(manager, "script-message-received::checkout", G_CALLBACK(checkout_message), state);
  GtkWidget* view = webkit_web_view_new_with_user_content_manager(manager);
  gtk_container_add(GTK_CONTAINER(window), view);
  g_signal_connect(window, "destroy", G_CALLBACK(+[](GtkWidget*, gpointer p) {
    auto* s = static_cast<DesktopState*>(p);
    s->checkout = nullptr;
    if (s->pending_checkout) {
      respond(s->pending_checkout);
      g_clear_object(&s->pending_checkout);
    }
  }), state);
  webkit_web_view_load_html(WEBKIT_WEB_VIEW(view), html, "https://checkout.razorpay.com/");
  gtk_widget_show_all(window);
}

gchar* window_state_path() {
  return g_build_filename(g_get_user_config_dir(), "vectra-cloud", "window.ini", nullptr);
}

gboolean window_configure(GtkWidget* widget, GdkEventConfigure* event, gpointer data) {
  auto* state = static_cast<DesktopState*>(data);
  GdkWindow* window = gtk_widget_get_window(widget);
  if (window && !(gdk_window_get_state(window) & (GDK_WINDOW_STATE_MAXIMIZED | GDK_WINDOW_STATE_FULLSCREEN))) {
    state->width = event->width;
    state->height = event->height;
  }
  return FALSE;
}

gboolean window_state(GtkWidget*, GdkEventWindowState* event, gpointer data) {
  static_cast<DesktopState*>(data)->maximized = event->new_window_state & GDK_WINDOW_STATE_MAXIMIZED;
  return FALSE;
}

gboolean window_delete(GtkWidget*, GdkEvent*, gpointer data) {
  auto* state = static_cast<DesktopState*>(data);
  g_autoptr(GKeyFile) file = g_key_file_new();
  g_key_file_set_integer(file, "Window", "width", state->width);
  g_key_file_set_integer(file, "Window", "height", state->height);
  g_key_file_set_boolean(file, "Window", "maximized", state->maximized);
  g_autofree gchar* path = window_state_path();
  g_autofree gchar* dir = g_path_get_dirname(path);
  g_mkdir_with_parents(dir, 0700);
  g_key_file_save_to_file(file, path, nullptr);
  return FALSE;
}

void files_dropped(GtkWidget*, GdkDragContext* context, gint, gint,
                   GtkSelectionData* selection, guint, guint time, gpointer data) {
  auto* state = static_cast<DesktopState*>(data);
  g_auto(GStrv) uris = gtk_selection_data_get_uris(selection);
  g_autoptr(FlValue) files = fl_value_new_list();
  for (int i = 0; uris && uris[i] && i < 12; ++i) {
    g_autofree gchar* path = g_filename_from_uri(uris[i], nullptr, nullptr);
    if (path && g_file_test(path, G_FILE_TEST_IS_REGULAR))
      fl_value_append_take(files, fl_value_new_string(path));
  }
  const bool accepted = fl_value_get_length(files) > 0;
  if (accepted) fl_method_channel_invoke_method(state->channel, "filesDropped", files, nullptr, nullptr, nullptr);
  gtk_drag_finish(context, accepted, FALSE, time);
}

void clipboard_image(GtkClipboard*, GdkPixbuf* image, gpointer data) {
  auto* call = FL_METHOD_CALL(data);
  if (!image) {
    respond(call);
  } else {
    gchar* buffer = nullptr;
    gsize length = 0;
    if (gdk_pixbuf_save_to_buffer(image, &buffer, &length, "png", nullptr, nullptr)) {
      g_autoptr(FlValue) value = fl_value_new_uint8_list(reinterpret_cast<const uint8_t*>(buffer), length);
      respond(call, value);
      g_free(buffer);
    } else {
      fl_method_call_respond_error(call, "clipboard", "Could not read the clipboard image.", nullptr, nullptr);
    }
  }
  g_object_unref(call);
}

void desktop_call(FlMethodChannel*, FlMethodCall* call, gpointer data) {
  auto* state = static_cast<DesktopState*>(data);
  const gchar* method = fl_method_call_get_name(call);
  FlValue* args = fl_method_call_get_args(call);
  if (strcmp(method, "inlineLoad") == 0) {
    const gchar* id = string_field(args, "id");
    const gchar* url = string_field(args, "url");
    bool viewer = id && g_strcmp0(id, "ai-viewer") == 0;
    if (!id || (!viewer && g_strcmp0(id, "preview") != 0) || !allowed_url(url, viewer)) {
      fl_method_call_respond_error(call, "url", "An allowed HTTP(S) browser URL is required.", nullptr, nullptr);
      return;
    }
    InlineSurface* surface = lookup_inline_surface(state, id);
    if (!surface) surface = create_inline_surface(state, id, viewer);
    if (viewer) {
      g_free(surface->locked_url);
      surface->locked_url = g_strdup(url);
    }
    webkit_web_view_load_uri(WEBKIT_WEB_VIEW(surface->view), url);
    respond(call);
  } else if (strcmp(method, "inlineShow") == 0) {
    const gchar* id = string_field(args, "id");
    if (!lookup_inline_surface(state, id)) {
      fl_method_call_respond_error(call, "browser", "Browser surface is not available.", nullptr, nullptr);
      return;
    }
    FlValue* x = value_field(args, "x", FL_VALUE_TYPE_FLOAT);
    FlValue* y = value_field(args, "y", FL_VALUE_TYPE_FLOAT);
    FlValue* width = value_field(args, "width", FL_VALUE_TYPE_FLOAT);
    FlValue* height = value_field(args, "height", FL_VALUE_TYPE_FLOAT);
    FlValue* ratio = value_field(args, "pixelRatio", FL_VALUE_TYPE_FLOAT);
    if (!x || !y || !width || !height || !ratio ||
        fl_value_get_float(width) < 1 || fl_value_get_float(height) < 1 ||
        fl_value_get_float(ratio) <= 0) {
      fl_method_call_respond_error(call, "bounds", "Browser bounds are invalid.", nullptr, nullptr);
      return;
    }
    const double scale = fl_value_get_float(ratio) / gtk_widget_get_scale_factor(GTK_WIDGET(state->flutter_view));
    GtkAllocation area;
    gtk_widget_get_allocation(GTK_WIDGET(state->flutter_view), &area);
    const int left = lround(fl_value_get_float(x) * scale);
    const int top = lround(fl_value_get_float(y) * scale);
    const int right = lround((fl_value_get_float(x) + fl_value_get_float(width)) * scale);
    const int bottom = lround((fl_value_get_float(y) + fl_value_get_float(height)) * scale);
    state->inline_bounds = {CLAMP(left, 0, area.width), CLAMP(top, 0, area.height),
      MAX(0, MIN(right, area.width) - CLAMP(left, 0, area.width)),
      MAX(0, MIN(bottom, area.height) - CLAMP(top, 0, area.height))};
    show_inline_surface(state, id);
    respond(call);
  } else if (strcmp(method, "inlineHide") == 0) {
    const gchar* id = string_field(args, "id");
    if (id && g_strcmp0(id, state->visible_surface) == 0) show_inline_surface(state, nullptr);
    respond(call);
  } else if (strcmp(method, "inlineDispose") == 0) {
    const gchar* id = string_field(args, "id");
    if (id && g_strcmp0(id, state->visible_surface) == 0) show_inline_surface(state, nullptr);
    if (id) g_hash_table_remove(state->inline_surfaces, id);
    respond(call);
  } else if (strcmp(method, "inlineCommand") == 0) {
    const gchar* id = string_field(args, "id");
    const gchar* command = string_field(args, "command");
    InlineSurface* surface = lookup_inline_surface(state, id);
    if (!surface || !command) {
      fl_method_call_respond_error(call, "browser", "Browser surface is not available.", nullptr, nullptr);
      return;
    }
    if (!surface->viewer) {
      if (g_strcmp0(command, "back") == 0) webkit_web_view_go_back(WEBKIT_WEB_VIEW(surface->view));
      else if (g_strcmp0(command, "forward") == 0) webkit_web_view_go_forward(WEBKIT_WEB_VIEW(surface->view));
      else if (g_strcmp0(command, "reload") == 0) webkit_web_view_reload(WEBKIT_WEB_VIEW(surface->view));
    } else if (g_strcmp0(command, "reload") == 0) {
      webkit_web_view_reload(WEBKIT_WEB_VIEW(surface->view));
    }
    respond(call);
  } else if (strcmp(method, "clipboardImage") == 0) {
    gtk_clipboard_request_image(gtk_clipboard_get(GDK_SELECTION_CLIPBOARD), clipboard_image, g_object_ref(call));
  } else if (strcmp(method, "fullscreen") == 0) {
    GdkWindow* window = gtk_widget_get_window(GTK_WIDGET(state->window));
    if (gdk_window_get_state(window) & GDK_WINDOW_STATE_FULLSCREEN)
      gtk_window_unfullscreen(state->window);
    else gtk_window_fullscreen(state->window);
    respond(call);
  } else if (strcmp(method, "focus") == 0) {
    gtk_window_present(state->window);
    respond(call);
  } else if (strcmp(method, "checkout") == 0 && fl_value_get_type(args) == FL_VALUE_TYPE_MAP) {
    open_checkout(state, call, args);
  } else {
    fl_method_call_respond_not_implemented(call, nullptr);
  }
}

void destroy_state(gpointer data) {
  auto* state = static_cast<DesktopState*>(data);
  if (state->checkout) gtk_widget_destroy(state->checkout);
  g_free(state->visible_surface);
  if (state->inline_surfaces) g_hash_table_destroy(state->inline_surfaces);
  fl_method_channel_set_method_call_handler(state->channel, nullptr, nullptr, nullptr);
  g_clear_object(&state->channel);
  delete state;
}
}

void desktop_integration_attach(GtkWindow* window, FlView* view, GtkOverlay* overlay) {
  auto* state = new DesktopState{window, overlay, view};
  state->inline_surfaces = g_hash_table_new_full(g_str_hash, g_str_equal, g_free, destroy_inline_surface);
  g_signal_connect(overlay, "get-child-position", G_CALLBACK(position_inline_browser), state);
  g_autoptr(FlStandardMethodCodec) codec = fl_standard_method_codec_new();
  state->channel = fl_method_channel_new(
      fl_engine_get_binary_messenger(fl_view_get_engine(view)),
      "in.xibeai.vectra_cloud/desktop", FL_METHOD_CODEC(codec));
  fl_method_channel_set_method_call_handler(state->channel, desktop_call, state, nullptr);
  g_object_set_data_full(G_OBJECT(window), "desktop-integration", state, destroy_state);
  GdkGeometry geometry = {};
  geometry.min_width = 680;
  geometry.min_height = 480;
  gtk_window_set_geometry_hints(window, nullptr, &geometry, GDK_HINT_MIN_SIZE);
  g_autoptr(GKeyFile) saved = g_key_file_new();
  g_autofree gchar* path = window_state_path();
  if (g_key_file_load_from_file(saved, path, G_KEY_FILE_NONE, nullptr)) {
    state->width = CLAMP(g_key_file_get_integer(saved, "Window", "width", nullptr), 680, 3840);
    state->height = CLAMP(g_key_file_get_integer(saved, "Window", "height", nullptr), 480, 2160);
    gtk_window_resize(window, state->width, state->height);
    if (g_key_file_get_boolean(saved, "Window", "maximized", nullptr)) gtk_window_maximize(window);
  }
  g_signal_connect(window, "configure-event", G_CALLBACK(window_configure), state);
  g_signal_connect(window, "window-state-event", G_CALLBACK(window_state), state);
  g_signal_connect(window, "delete-event", G_CALLBACK(window_delete), state);
  gtk_drag_dest_set(GTK_WIDGET(view), GTK_DEST_DEFAULT_ALL, nullptr, 0, GDK_ACTION_COPY);
  gtk_drag_dest_add_uri_targets(GTK_WIDGET(view));
  g_signal_connect(view, "drag-data-received", G_CALLBACK(files_dropped), state);
}
