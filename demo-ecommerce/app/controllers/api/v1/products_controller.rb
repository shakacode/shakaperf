module Api
  module V1
    class ProductsController < BaseController
      def index
        products = Product.all
        products = products.where(category: params[:category]) if params[:category].present?
        render json: products
      end

      def show
        product = Product.find(params[:id])
        render json: product
      rescue ActiveRecord::RecordNotFound
        render json: { error: 'Product not found' }, status: :not_found
      end
    end
  end
end
