Rails.application.routes.draw do
  root 'pages#index'

  # React SPA routes - all handled by React Router
  get '/products', to: 'pages#index'
  get '/products/:id', to: 'pages#index'
  get '/cart', to: 'pages#index'

  # API endpoints
  namespace :api do
    namespace :v1 do
      resources :products, only: %i[index show]
    end
  end

  # Health check
  get "up" => "rails/health#show", as: :rails_health_check

  # PWA
  get "service-worker" => "rails/pwa#service_worker", as: :pwa_service_worker
  get "manifest" => "rails/pwa#manifest", as: :pwa_manifest
end
