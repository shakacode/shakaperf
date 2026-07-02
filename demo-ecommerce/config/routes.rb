Rails.application.routes.draw do
  root "pages#index"

  # React SPA routes - all handled by React Router
  get "/products", to: "pages#index"
  get "/products/:id", to: "pages#index"
  get "/products/:id/reviews", to: "pages#index"
  get "/deals", to: "pages#index"
  get "/cart", to: "pages#index"
  get "/carousel-demo", to: "pages#index"

  # Admin SPA routes - all handled by React Router
  get "/admin", to: "admin#index"
  get "/admin/*path", to: "admin#index"

  # API endpoints
  namespace :api do
    namespace :v1 do
      resources :products, only: %i[index show]

      # Cart endpoints
      resource :cart, only: [ :show ] do
        delete "/", to: "carts#clear"
        post "items", to: "carts#add_item"
        patch "items/:product_id", to: "carts#update_item"
        delete "items/:product_id", to: "carts#remove_item"
      end
    end
  end

  # Health check
  get "up" => "rails/health#show", as: :rails_health_check

  # PWA
  get "service-worker" => "rails/pwa#service_worker", as: :pwa_service_worker
  get "manifest" => "rails/pwa#manifest", as: :pwa_manifest
end
